/**
 * Electron Main Process
 * This file creates and manages the desktop application window
 * Includes HTTP server for browser extension sync and IPC handlers
 */

import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron';
import { exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { WebSocketServer } from 'ws';
import psList from 'ps-list';
import open from 'open';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;

// ==========================================
// WINDOWS FOCUS HELPER
// ==========================================

/**
 * Simulate Alt key press/release AND bring browser window to foreground.
 * Windows prevents background apps from stealing focus, but simulating a keypress
 * tricks the system into thinking there was user input, allowing focus to change.
 */
function focusBrowserWindow() {
    if (process.platform !== 'win32') return Promise.resolve();

    return new Promise((resolve) => {
        // Use PowerShell with inline C# - escape for cmd properly
        // The C# code is base64 encoded to avoid escaping issues
        const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class FocusHelper {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;
    const int SW_SHOWMAXIMIZED = 3;

    public static void FocusBrowser() {
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        string[] browsers = { "chrome", "msedge", "firefox" };
        foreach (var name in browsers) {
            var procs = Process.GetProcessesByName(name);
            foreach (var p in procs) {
                if (p.MainWindowHandle != IntPtr.Zero) {
                    IntPtr hwnd = p.MainWindowHandle;
                    uint fgThread;
                    GetWindowThreadProcessId(GetForegroundWindow(), out fgThread);
                    uint curThread = GetCurrentThreadId();
                    AttachThreadInput(curThread, fgThread, true);

                    // Check window state and restore appropriately
                    if (IsIconic(hwnd)) {
                        // Window is minimized - restore it
                        ShowWindow(hwnd, SW_RESTORE);
                    } else {
                        // Window is not minimized - just bring to front without changing size
                        ShowWindow(hwnd, SW_SHOW);
                    }

                    SetForegroundWindow(hwnd);
                    AttachThreadInput(curThread, fgThread, false);
                    return;
                }
            }
        }
    }
}`;
        // Base64 encode the C# code for safe passing
        const b64Code = Buffer.from(csharpCode).toString('base64');

        const psCommand = `$code=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Code}'));Add-Type -TypeDefinition $code;[FocusHelper]::FocusBrowser()`;

        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, { windowsHide: true }, (error) => {
            if (error) {
                console.warn('[Electron] Focus browser failed:', error.message);
            } else {
                console.log('[Electron] Browser window focused');
            }
            resolve();
        });
    });
}

// ==========================================
// CROSS-PLATFORM APP DISCOVERY
// ==========================================

// Installed apps cache
let installedAppsCache = null;
let installedAppsCacheTime = 0;
const INSTALLED_APPS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get running applications with visible windows (cross-platform)
 */
async function getRunningApps() {
    const platform = process.platform;

    try {
        if (platform === 'win32') {
            return await getRunningAppsWindows();
        } else if (platform === 'darwin') {
            return await getRunningAppsMac();
        } else {
            return await getRunningAppsLinux();
        }
    } catch (e) {
        console.warn('[Electron] getRunningApps failed:', e.message);
        return [];
    }
}

/**
 * Windows: Get running apps using PowerShell
 */
async function getRunningAppsWindows() {
    // PowerShell script to get running apps with visible windows
    const psScript = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Name, Id, Path, MainWindowTitle | ConvertTo-Json`;
    // Encode as base64 to avoid escaping issues with $_
    const b64Script = Buffer.from(psScript, 'utf16le').toString('base64');

    try {
        const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${b64Script}`, { windowsHide: true });

        if (!stdout || stdout.trim() === '') return [];

        const processes = JSON.parse(stdout);
        const procArray = Array.isArray(processes) ? processes : [processes];

        return procArray.map(p => ({
            id: `app-${p.Id}`,
            pid: p.Id,
            title: p.MainWindowTitle || p.Name,
            name: p.Name,
            path: p.Path || '',
            type: 'app',
            isRunning: true
        })).filter(p => p.name && p.title);
    } catch (e) {
        console.error('[Electron] getRunningAppsWindows error:', e.message);
        return [];
    }
}

/**
 * macOS: Get running apps using AppleScript
 */
async function getRunningAppsMac() {
    try {
        const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get {name, unix id} of (processes where background only is false)'`);
        // AppleScript returns: {name1, name2, ...}, {id1, id2, ...}
        const parts = stdout.trim().split(', ');
        const apps = [];

        // Parse the output - it's comma separated
        const names = [];
        const pids = [];
        let inNames = true;

        for (const part of parts) {
            const cleanPart = part.replace(/[{}]/g, '').trim();
            if (cleanPart.match(/^\d+$/)) {
                inNames = false;
                pids.push(parseInt(cleanPart));
            } else if (inNames && cleanPart) {
                names.push(cleanPart);
            }
        }

        for (let i = 0; i < names.length; i++) {
            apps.push({
                id: `app-${pids[i] || i}`,
                pid: pids[i] || 0,
                title: names[i],
                name: names[i],
                path: `/Applications/${names[i]}.app`,
                type: 'app',
                isRunning: true
            });
        }

        return apps;
    } catch (e) {
        console.warn('[Electron] getRunningAppsMac failed:', e.message);
        return [];
    }
}

/**
 * Linux: Get running apps using wmctrl or fallback to ps-list
 */
async function getRunningAppsLinux() {
    try {
        // Try wmctrl first (more reliable for windowed apps)
        const { stdout } = await execAsync('wmctrl -l -p');
        return stdout.split('\n').filter(Boolean).map(line => {
            const parts = line.split(/\s+/);
            const pid = parseInt(parts[2]) || 0;
            const title = parts.slice(4).join(' ');
            return {
                id: `app-${pid}`,
                pid,
                title,
                name: title.split(' - ')[0] || title,
                path: '',
                type: 'app',
                isRunning: true
            };
        });
    } catch {
        // Fallback to ps-list
        try {
            const processes = await psList();
            return processes
                .filter(p => p.name && !p.name.startsWith('['))
                .slice(0, 50)
                .map(p => ({
                    id: `app-${p.pid}`,
                    pid: p.pid,
                    name: p.name,
                    title: p.name,
                    path: '',
                    type: 'app',
                    isRunning: true
                }));
        } catch (e) {
            console.warn('[Electron] getRunningAppsLinux fallback failed:', e.message);
            return [];
        }
    }
}

/**
 * Get installed applications (cached, cross-platform)
 */
async function getInstalledApps() {
    // Return cached if fresh
    if (installedAppsCache && Date.now() - installedAppsCacheTime < INSTALLED_APPS_CACHE_TTL) {
        return installedAppsCache;
    }

    const platform = process.platform;
    let apps = [];

    try {
        if (platform === 'win32') {
            apps = await getInstalledAppsWindows();
        } else if (platform === 'darwin') {
            apps = await getInstalledAppsMac();
        } else {
            apps = await getInstalledAppsLinux();
        }
    } catch (e) {
        console.warn('[Electron] getInstalledApps failed:', e.message);
    }

    installedAppsCache = apps;
    installedAppsCacheTime = Date.now();
    return apps;
}

/**
 * Windows: Get installed apps from Start Menu shortcuts
 */
async function getInstalledAppsWindows() {
    // PowerShell script to get installed apps from Start Menu
    const psScript = `
$apps = @()
$paths = @(
    [Environment]::GetFolderPath('CommonStartMenu') + '\\Programs',
    [Environment]::GetFolderPath('StartMenu') + '\\Programs'
)
foreach ($startMenu in $paths) {
    if (Test-Path $startMenu) {
        Get-ChildItem $startMenu -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut($_.FullName)
                if ($shortcut.TargetPath -and $shortcut.TargetPath -match '\\.exe$') {
                    $apps += @{
                        name = $_.BaseName
                        path = $shortcut.TargetPath
                    }
                }
            } catch {}
        }
    }
}
$apps | Sort-Object -Property name -Unique | ConvertTo-Json -Compress
`;
    // Encode as base64 to avoid escaping issues
    const b64Script = Buffer.from(psScript, 'utf16le').toString('base64');

    try {
        const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${b64Script}`, {
            windowsHide: true,
            timeout: 30000
        });

        if (!stdout || stdout.trim() === '' || stdout.trim() === 'null') return [];

        const apps = JSON.parse(stdout);
        const appArray = Array.isArray(apps) ? apps : [apps];

        return appArray
            .filter(a => a && a.name)
            .map(a => ({
                id: `installed-${a.name}`,
                name: a.name,
                title: a.name,
                path: a.path,
                type: 'app',
                isRunning: false
            }));
    } catch (e) {
        console.warn('[Electron] getInstalledAppsWindows failed:', e.message);
        return [];
    }
}

/**
 * macOS: Get installed apps from /Applications
 */
async function getInstalledAppsMac() {
    try {
        const { stdout } = await execAsync('ls /Applications | grep ".app$"');
        return stdout.split('\n').filter(Boolean).map(name => {
            const appName = name.replace('.app', '');
            return {
                id: `installed-${appName}`,
                name: appName,
                title: appName,
                path: `/Applications/${name}`,
                type: 'app',
                isRunning: false
            };
        });
    } catch (e) {
        console.warn('[Electron] getInstalledAppsMac failed:', e.message);
        return [];
    }
}

/**
 * Linux: Get installed apps from .desktop files
 */
async function getInstalledAppsLinux() {
    const desktopPaths = [
        '/usr/share/applications',
        `${process.env.HOME}/.local/share/applications`
    ];

    const apps = [];
    for (const dir of desktopPaths) {
        try {
            const { stdout } = await execAsync(`find "${dir}" -maxdepth 1 -name "*.desktop" 2>/dev/null | head -100`);
            for (const file of stdout.split('\n').filter(Boolean)) {
                try {
                    const { stdout: content } = await execAsync(`grep -E "^(Name|Exec)=" "${file}" 2>/dev/null | head -2`);
                    const nameMatch = content.match(/Name=(.+)/);
                    const execMatch = content.match(/Exec=([^\s%]+)/);
                    if (nameMatch) {
                        apps.push({
                            id: `installed-${basename(file)}`,
                            name: nameMatch[1],
                            title: nameMatch[1],
                            path: execMatch?.[1] || '',
                            type: 'app',
                            isRunning: false
                        });
                    }
                } catch { /* ignore individual file errors */ }
            }
        } catch { /* ignore directory errors */ }
    }

    return apps;
}

/**
 * Focus an application window by PID (cross-platform)
 */
async function focusAppWindow(pid) {
    const platform = process.platform;

    try {
        if (platform === 'win32') {
            return await focusAppWindowWindows(pid);
        } else if (platform === 'darwin') {
            return await focusAppWindowMac(pid);
        } else {
            return await focusAppWindowLinux(pid);
        }
    } catch (e) {
        console.warn('[Electron] focusAppWindow failed:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * Windows: Focus window using PowerShell with SetForegroundWindow
 */
async function focusAppWindowWindows(pid) {
    const csharpCode = `
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;

public class AppFocus {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;

    public static void FocusByPid(int pid) {
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        try {
            Process p = Process.GetProcessById(pid);
            if (p.MainWindowHandle != IntPtr.Zero) {
                if (IsIconic(p.MainWindowHandle)) {
                    ShowWindow(p.MainWindowHandle, SW_RESTORE);
                } else {
                    ShowWindow(p.MainWindowHandle, SW_SHOW);
                }
                SetForegroundWindow(p.MainWindowHandle);
            }
        } catch {}
    }
}`;
    const b64Code = Buffer.from(csharpCode).toString('base64');
    const psCommand = `$code=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Code}'));Add-Type -TypeDefinition $code;[AppFocus]::FocusByPid(${pid})`;

    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, { windowsHide: true });
    return { success: true };
}

/**
 * macOS: Focus window using AppleScript
 */
async function focusAppWindowMac(pid) {
    // First get the app name from PID, then activate it
    const { stdout: appName } = await execAsync(`ps -p ${pid} -o comm= | xargs basename`);
    const name = appName.trim();
    if (name) {
        await execAsync(`osascript -e 'tell application "${name}" to activate'`);
    }
    return { success: true };
}

/**
 * Linux: Focus window using wmctrl or xdotool
 */
async function focusAppWindowLinux(pid) {
    try {
        // Try wmctrl first
        await execAsync(`wmctrl -i -a $(wmctrl -l -p | grep " ${pid} " | head -1 | cut -d' ' -f1)`);
        return { success: true };
    } catch {
        try {
            // Fallback to xdotool
            await execAsync(`xdotool search --pid ${pid} windowactivate`);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

/**
 * Launch an application by path (cross-platform)
 */
async function launchApp(appPath) {
    try {
        await open(appPath);
        return { success: true };
    } catch (e) {
        // Fallback to shell.openExternal
        try {
            await shell.openExternal(appPath);
            return { success: true };
        } catch (e2) {
            console.warn('[Electron] launchApp failed:', e2.message);
            return { success: false, error: e2.message };
        }
    }
}

let spotlightWindow;
let httpServer;
let wss;

// ==========================================
// SYNC DATA STORAGE
// ==========================================

const DATA_DIR = join(app.getPath('userData'), 'sync-data');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_FILE = join(DATA_DIR, 'sync-data.json');

// In-memory sync data store
let syncData = {
    workspaces: [],
    urls: [],
    settings: {},
    activity: [],
    notes: [],
    urlNotes: [],       // Added
    pins: [],           // Added
    scrapedChats: [],   // Added
    scrapedConfigs: [], // Added
    dailyMemory: [],    // Added
    uiState: {},
    dashboard: {},
    tabs: [],
    lastUpdated: {}
};

// Load persisted data on startup
function loadData() {
    try {
        if (existsSync(DATA_FILE)) {
            const content = readFileSync(DATA_FILE, 'utf-8');
            const loaded = JSON.parse(content);
            // Merge with default structure to ensure all keys exist
            syncData = { ...syncData, ...loaded };
            console.log('[Electron] Loaded sync data from disk');
        }
    } catch (error) {
        console.warn('[Electron] Failed to load sync data:', error);
    }
}

// Save data to disk
function saveData() {
    try {
        writeFileSync(DATA_FILE, JSON.stringify(syncData, null, 2));
    } catch (error) {
        console.warn('[Electron] Failed to save sync data:', error);
    }
}

// Notify renderer of external updates
function notifyRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// Broadcast to all WebSocket clients
function broadcastToClients(type, payload) {
    if (!wss) return;
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

// ==========================================
// HTTP SERVER FOR BROWSER EXTENSION SYNC
// ==========================================

function startHttpServer() {
    const PORT = 4000;

    httpServer = createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://localhost:${PORT}`);
        const path = url.pathname;

        // Parse JSON body for POST requests
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = body ? JSON.parse(body) : {};
                    handlePostRequest(path, data, res);
                } catch (error) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
        } else if (req.method === 'GET') {
            handleGetRequest(path, url, res);
        } else {
            res.writeHead(405);
            res.end();
        }
    });

    // WebSocket server for real-time updates
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
        console.log('[Electron] WebSocket client connected');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                handleWebSocketMessage(ws, data);
            } catch (error) {
                console.warn('[Electron] Invalid WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            console.log('[Electron] WebSocket client disconnected');
        });

        // Send current state on connection
        ws.send(JSON.stringify({
            type: 'sync-state',
            payload: {
                workspaces: syncData.workspaces,
                tabs: syncData.tabs,
                settings: syncData.settings,
                lastUpdated: syncData.lastUpdated
                // Note: Full state might be too large to send on connect
            }
        }));
    });

    httpServer.listen(PORT, '127.0.0.1', () => {
        console.log(`[Electron] Sync server running on http://127.0.0.1:${PORT}`);
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.warn(`[Electron] Port ${PORT} already in use, sync server disabled`);
        } else {
            console.error('[Electron] HTTP server error:', error);
        }
    });
}

function handleGetRequest(path, url, res) {
    res.setHeader('Content-Type', 'application/json');

    switch (path) {
        case '/workspaces':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.workspaces));
            break;

        case '/urls':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.urls));
            break;

        case '/settings':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.settings));
            break;

        case '/activity':
            const since = url.searchParams.get('since');
            let activity = syncData.activity;
            if (since) {
                const sinceMs = parseInt(since, 10);
                activity = activity.filter(a => (a.timestamp || 0) > sinceMs);
            }
            res.writeHead(200);
            res.end(JSON.stringify(activity));
            break;

        case '/notes':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.notes));
            break;

        case '/url-notes':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.urlNotes));
            break;

        case '/pins':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.pins));
            break;

        case '/scraped-chats':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.scrapedChats));
            break;

        case '/scraped-configs':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.scrapedConfigs));
            break;

        case '/daily-memory':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.dailyMemory));
            break;

        case '/ui-state':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.uiState));
            break;

        case '/dashboard':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.dashboard));
            break;

        case '/tabs':
            res.writeHead(200);
            res.end(JSON.stringify(syncData.tabs));
            break;

        case '/health':
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
            break;

        default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
    }
}

function handlePostRequest(path, data, res) {
    switch (path) {
        case '/workspaces':
            syncData.workspaces = Array.isArray(data) ? data : [];
            syncData.lastUpdated.workspaces = Date.now();
            saveData();
            notifyRenderer('workspaces-updated', syncData.workspaces);
            broadcastToClients('workspaces-updated', syncData.workspaces);
            res.writeHead(204);
            res.end();
            break;

        case '/urls':
            syncData.urls = Array.isArray(data) ? data : [];
            syncData.lastUpdated.urls = Date.now();
            saveData();
            notifyRenderer('urls-updated', syncData.urls);
            broadcastToClients('urls-updated', syncData.urls);
            res.writeHead(204);
            res.end();
            break;

        case '/settings':
            syncData.settings = { ...syncData.settings, ...data };
            syncData.lastUpdated.settings = Date.now();
            saveData();
            notifyRenderer('settings-updated', syncData.settings);
            broadcastToClients('settings-updated', syncData.settings);
            res.writeHead(204);
            res.end();
            break;

        case '/activity':
            const activities = Array.isArray(data) ? data : [data];
            syncData.activity = [...syncData.activity, ...activities].slice(-1000); // Keep last 1000
            syncData.lastUpdated.activity = Date.now();
            saveData();
            notifyRenderer('activity-updated', activities);
            broadcastToClients('activity-updated', activities);
            res.writeHead(204);
            res.end();
            break;

        case '/notes':
            syncData.notes = Array.isArray(data) ? data : [];
            syncData.lastUpdated.notes = Date.now();
            saveData();
            notifyRenderer('notes-updated', syncData.notes);
            broadcastToClients('notes-updated', syncData.notes);
            res.writeHead(204);
            res.end();
            break;

        case '/url-notes':
            syncData.urlNotes = Array.isArray(data) ? data : [];
            syncData.lastUpdated.urlNotes = Date.now();
            saveData();
            notifyRenderer('url-notes-updated', syncData.urlNotes);
            broadcastToClients('url-notes-updated', syncData.urlNotes);
            res.writeHead(204);
            res.end();
            break;

        case '/pins':
            syncData.pins = Array.isArray(data) ? data : [];
            syncData.lastUpdated.pins = Date.now();
            saveData();
            notifyRenderer('pins-updated', syncData.pins);
            broadcastToClients('pins-updated', syncData.pins);
            res.writeHead(204);
            res.end();
            break;

        case '/scraped-chats':
            syncData.scrapedChats = Array.isArray(data) ? data : [];
            syncData.lastUpdated.scrapedChats = Date.now();
            saveData();
            notifyRenderer('scraped-chats-updated', syncData.scrapedChats);
            broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
            res.writeHead(204);
            res.end();
            break;

        case '/scraped-configs':
            syncData.scrapedConfigs = Array.isArray(data) ? data : [];
            syncData.lastUpdated.scrapedConfigs = Date.now();
            saveData();
            notifyRenderer('scraped-configs-updated', syncData.scrapedConfigs);
            broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
            res.writeHead(204);
            res.end();
            break;

        case '/daily-memory':
            syncData.dailyMemory = Array.isArray(data) ? data : [];
            syncData.lastUpdated.dailyMemory = Date.now();
            saveData();
            notifyRenderer('daily-memory-updated', syncData.dailyMemory);
            broadcastToClients('daily-memory-updated', syncData.dailyMemory);
            res.writeHead(204);
            res.end();
            break;

        case '/ui-state':
            syncData.uiState = { ...syncData.uiState, ...data };
            saveData();
            notifyRenderer('ui-state-updated', syncData.uiState);
            broadcastToClients('ui-state-updated', syncData.uiState);
            res.writeHead(204);
            res.end();
            break;

        case '/dashboard':
            syncData.dashboard = { ...syncData.dashboard, ...data };
            saveData();
            notifyRenderer('dashboard-updated', syncData.dashboard);
            broadcastToClients('dashboard-updated', syncData.dashboard);
            res.writeHead(204);
            res.end();
            break;

        case '/tabs':
            syncData.tabs = Array.isArray(data) ? data : [];
            syncData.lastUpdated.tabs = Date.now();
            saveData();
            notifyRenderer('tabs-updated', syncData.tabs);
            broadcastToClients('tabs-updated', syncData.tabs);
            res.writeHead(204);
            res.end();
            break;

        case '/sync':
            // Full sync request - merge incoming data
            if (data.workspaces) {
                syncData.workspaces = mergeArrayById(syncData.workspaces, data.workspaces);
                syncData.lastUpdated.workspaces = Date.now();
            }
            if (data.urls) {
                syncData.urls = mergeArrayById(syncData.urls, data.urls);
                syncData.lastUpdated.urls = Date.now();
            }
            if (data.tabs) {
                syncData.tabs = data.tabs;
                syncData.lastUpdated.tabs = Date.now();
            }
            if (data.settings) {
                syncData.settings = { ...syncData.settings, ...data.settings };
                syncData.lastUpdated.settings = Date.now();
            }
            if (data.notes) {
                syncData.notes = mergeArrayById(syncData.notes, data.notes);
                syncData.lastUpdated.notes = Date.now();
            }
            if (data.urlNotes) {
                syncData.urlNotes = mergeArrayById(syncData.urlNotes, data.urlNotes);
                syncData.lastUpdated.urlNotes = Date.now();
            }
            if (data.pins) {
                syncData.pins = mergeArrayById(syncData.pins, data.pins);
                syncData.lastUpdated.pins = Date.now();
            }
            if (data.scrapedChats) {
                syncData.scrapedChats = mergeArrayById(syncData.scrapedChats, data.scrapedChats, 'scrapedChats');
                syncData.lastUpdated.scrapedChats = Date.now();
            }
            if (data.scrapedConfigs) {
                syncData.scrapedConfigs = mergeArrayById(syncData.scrapedConfigs, data.scrapedConfigs, 'scrapedConfigs');
                syncData.lastUpdated.scrapedConfigs = Date.now();
            }
            if (data.dailyMemory) {
                syncData.dailyMemory = mergeArrayById(syncData.dailyMemory, data.dailyMemory);
                syncData.lastUpdated.dailyMemory = Date.now();
            }

            saveData();
            notifyRenderer('sync-complete', { timestamp: Date.now() });
            res.writeHead(200);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                ok: true,
                ...syncData
            }));
            break;

        default:
            res.writeHead(404);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Not found' }));
    }
}

function handleWebSocketMessage(ws, data) {
    const { type, payload } = data;

    switch (type) {
        case 'request-state':
            ws.send(JSON.stringify({
                type: 'sync-state',
                payload: {
                    workspaces: syncData.workspaces,
                    tabs: syncData.tabs,
                    urls: syncData.urls,
                    settings: syncData.settings,
                    lastUpdated: syncData.lastUpdated
                }
            }));
            break;

        case 'push-workspaces':
            syncData.workspaces = payload;
            syncData.lastUpdated.workspaces = Date.now();
            saveData();
            notifyRenderer('workspaces-updated', syncData.workspaces);
            broadcastToClients('workspaces-updated', syncData.workspaces);
            break;

        case 'push-urls':
            syncData.urls = payload;
            syncData.lastUpdated.urls = Date.now();
            saveData();
            notifyRenderer('urls-updated', syncData.urls);
            broadcastToClients('urls-updated', syncData.urls);
            break;

        case 'push-settings':
            syncData.settings = { ...syncData.settings, ...payload };
            syncData.lastUpdated.settings = Date.now();
            saveData();
            notifyRenderer('settings-updated', syncData.settings);
            broadcastToClients('settings-updated', syncData.settings);
            break;

        case 'push-dashboard':
            syncData.dashboard = payload;
            saveData();
            notifyRenderer('dashboard-updated', syncData.dashboard);
            broadcastToClients('dashboard-updated', syncData.dashboard);
            break;

        case 'push-tabs':
            console.log(`[Electron] Received push-tabs with ${Array.isArray(payload) ? payload.length : 'invalid'} tabs`);
            syncData.tabs = Array.isArray(payload) ? payload : [];
            syncData.lastUpdated.tabs = Date.now();
            saveData(); // Optional for volatile data
            notifyRenderer('tabs-updated', syncData.tabs);
            broadcastToClients('tabs-updated', syncData.tabs);
            break;

        case 'push-activity':
            const activities = Array.isArray(payload) ? payload : [payload];
            syncData.activity = [...syncData.activity, ...activities].slice(-1000);
            syncData.lastUpdated.activity = Date.now();
            saveData();
            notifyRenderer('activity-updated', activities);
            broadcastToClients('activity-updated', activities);
            break;

        case 'push-notes':
            syncData.notes = payload;
            syncData.lastUpdated.notes = Date.now();
            saveData();
            notifyRenderer('notes-updated', syncData.notes);
            broadcastToClients('notes-updated', syncData.notes);
            break;

        case 'push-url-notes':
            syncData.urlNotes = payload;
            syncData.lastUpdated.urlNotes = Date.now();
            saveData();
            notifyRenderer('url-notes-updated', syncData.urlNotes);
            broadcastToClients('url-notes-updated', syncData.urlNotes);
            break;

        case 'push-pins':
            syncData.pins = payload;
            syncData.lastUpdated.pins = Date.now();
            saveData();
            notifyRenderer('pins-updated', syncData.pins);
            broadcastToClients('pins-updated', syncData.pins);
            break;

        case 'push-scraped-chats':
            syncData.scrapedChats = payload;
            syncData.lastUpdated.scrapedChats = Date.now();
            saveData();
            notifyRenderer('scraped-chats-updated', syncData.scrapedChats);
            broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
            break;

        case 'push-scraped-configs':
            syncData.scrapedConfigs = payload;
            syncData.lastUpdated.scrapedConfigs = Date.now();
            saveData();
            notifyRenderer('scraped-configs-updated', syncData.scrapedConfigs);
            broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
            break;

        case 'push-daily-memory':
            syncData.dailyMemory = payload;
            syncData.lastUpdated.dailyMemory = Date.now();
            saveData();
            notifyRenderer('daily-memory-updated', syncData.dailyMemory);
            broadcastToClients('daily-memory-updated', syncData.dailyMemory);
            break;

        case 'push-ui-state':
            syncData.uiState = { ...syncData.uiState, ...payload };
            saveData();
            notifyRenderer('ui-state-updated', syncData.uiState);
            broadcastToClients('ui-state-updated', syncData.uiState);
            break;

        default:
            console.log('[Electron] Unknown WebSocket message type:', type);
    }
}

// Merge arrays by ID (last-write-wins based on updatedAt)
// type parameter determines which field to use as ID
function mergeArrayById(local, remote, type = 'default') {
    const merged = new Map();

    // Determine the ID field based on type
    const getItemId = (item) => {
        if (type === 'scrapedChats') return item.chatId;
        if (type === 'scrapedConfigs') return item.domain;
        return item.id;
    };

    // Add all local items
    for (const item of local) {
        const itemId = getItemId(item);
        if (itemId) {
            merged.set(itemId, item);
        }
    }

    // Merge remote items (override if newer or doesn't exist)
    for (const item of remote) {
        const itemId = getItemId(item);
        if (!itemId) continue;
        const existing = merged.get(itemId);
        const remoteTime = item.updatedAt || item.scrapedAt || item.createdAt || 0;
        const localTime = existing?.updatedAt || existing?.scrapedAt || existing?.createdAt || 0;

        if (!existing || remoteTime >= localTime) {
            merged.set(itemId, item);
        }
    }

    return Array.from(merged.values());
}

// ==========================================
// WINDOW CREATION
// ==========================================

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, 'electron-preload.js'),
            webSecurity: false, // Allow loading local resources
        },
        backgroundColor: '#0f172a',
        titleBarStyle: 'default',
        icon: join(__dirname, 'public', 'icon-128.png'),
    });

    // Load the app
    if (process.env.NODE_ENV === 'development') {
        // Development: load from Vite dev server
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // Production: load from built files
        mainWindow.loadFile(join(__dirname, 'dist-electron', 'index.html'));
    }

    // Handle window events
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links
    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

let spotlightReady = false;

function createSpotlightWindow() {
    spotlightWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: true,
        show: false, // Hidden by default
        hasShadow: false, // We render our own shadow in CSS for better control
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, 'electron-preload.js'),
            backgroundThrottling: false, // Keep renderer active even when hidden
        }
    });

    // Mark as ready when content is loaded
    spotlightWindow.webContents.on('did-finish-load', () => {
        spotlightReady = true;
        console.log('[Electron] Spotlight window ready');
    });

    // Load the app with spotlight hash
    if (process.env.NODE_ENV === 'development') {
        spotlightWindow.loadURL('http://localhost:5173/#/spotlight');
    } else {
        spotlightWindow.loadFile(join(__dirname, 'dist-electron', 'index.html'), { hash: '/spotlight' });
    }
}

/**
 * Center spotlight window on the display where the cursor is located
 */
function centerSpotlightOnCursorDisplay() {
    if (!spotlightWindow || spotlightWindow.isDestroyed()) return;

    // Get cursor position
    const cursorPoint = screen.getCursorScreenPoint();
    // Get the display that contains the cursor
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = currentDisplay.workArea;

    // Get spotlight window size
    const [winWidth, winHeight] = spotlightWindow.getSize();

    // Calculate centered position on the current display
    const centerX = Math.round(x + (width - winWidth) / 2);
    const centerY = Math.round(y + (height - winHeight) / 3); // Slightly above center (1/3 from top)

    spotlightWindow.setPosition(centerX, centerY);
}

function toggleSpotlight() {
    if (!spotlightWindow || spotlightWindow.isDestroyed()) {
        console.log('[Electron] Spotlight window missing, recreating...');
        createSpotlightWindow();
        // Show after creation with delay
        setTimeout(() => {
            if (spotlightWindow && !spotlightWindow.isDestroyed()) {
                centerSpotlightOnCursorDisplay();
                spotlightWindow.show();
                spotlightWindow.focus();
                spotlightWindow.webContents.focus();
            }
        }, 100);
        return;
    }

    const isVisible = spotlightWindow.isVisible();
    console.log('[Electron] Toggle spotlight, currently visible:', isVisible);

    if (isVisible) {
        spotlightWindow.hide();
    } else {
        // Center on the display where cursor is and show
        centerSpotlightOnCursorDisplay();
        spotlightWindow.showInactive(); // Show without stealing focus first
        spotlightWindow.focus(); // Then focus

        // On Windows, we may need to force the window to front
        if (process.platform === 'win32') {
            spotlightWindow.setAlwaysOnTop(true, 'screen-saver'); // Higher z-order
            spotlightWindow.moveTop();
        }

        // Focus the webContents to ensure keyboard input works immediately
        spotlightWindow.webContents.focus();

        // Send message to renderer to reset and focus input
        setTimeout(() => {
            if (spotlightWindow && !spotlightWindow.isDestroyed()) {
                spotlightWindow.webContents.send('spotlight-shown');
            }
        }, 10);
    }
}

// ==========================================
// IPC HANDLERS
// ==========================================

// Sync data handlers - API pattern (request-response)
ipcMain.handle('sync:get-workspaces', () => syncData.workspaces);
ipcMain.handle('sync:set-workspaces', (_event, data) => {
    syncData.workspaces = Array.isArray(data) ? data : [];
    syncData.lastUpdated.workspaces = Date.now();
    saveData();
    broadcastToClients('workspaces-updated', syncData.workspaces);
    return { ok: true };
});

ipcMain.handle('sync:get-urls', () => syncData.urls);
ipcMain.handle('sync:set-urls', (_event, data) => {
    syncData.urls = Array.isArray(data) ? data : [];
    syncData.lastUpdated.urls = Date.now();
    saveData();
    broadcastToClients('urls-updated', syncData.urls);
    return { ok: true };
});

ipcMain.handle('sync:get-settings', () => syncData.settings);
ipcMain.handle('sync:set-settings', (_event, data) => {
    syncData.settings = { ...syncData.settings, ...data };
    syncData.lastUpdated.settings = Date.now();
    saveData();
    broadcastToClients('settings-updated', syncData.settings);
    return { ok: true };
});

ipcMain.handle('sync:get-activity', (_event, since) => {
    if (since) {
        return syncData.activity.filter(a => (a.timestamp || 0) > since);
    }
    return syncData.activity;
});
ipcMain.handle('sync:set-activity', (_event, data) => {
    const activities = Array.isArray(data) ? data : [data];
    syncData.activity = [...syncData.activity, ...activities].slice(-1000);
    syncData.lastUpdated.activity = Date.now();
    saveData();
    broadcastToClients('activity-updated', activities);
    return { ok: true };
});

ipcMain.handle('sync:get-notes', () => syncData.notes);
ipcMain.handle('sync:set-notes', (_event, data) => {
    syncData.notes = Array.isArray(data) ? data : [];
    syncData.lastUpdated.notes = Date.now();
    saveData();
    broadcastToClients('notes-updated', syncData.notes);
    return { ok: true };
});

ipcMain.handle('sync:get-url-notes', () => syncData.urlNotes);
ipcMain.handle('sync:set-url-notes', (_event, data) => {
    syncData.urlNotes = Array.isArray(data) ? data : [];
    syncData.lastUpdated.urlNotes = Date.now();
    saveData();
    broadcastToClients('url-notes-updated', syncData.urlNotes);
    return { ok: true };
});

ipcMain.handle('sync:get-pins', () => syncData.pins);
ipcMain.handle('sync:set-pins', (_event, data) => {
    syncData.pins = Array.isArray(data) ? data : [];
    syncData.lastUpdated.pins = Date.now();
    saveData();
    broadcastToClients('pins-updated', syncData.pins);
    return { ok: true };
});

ipcMain.handle('sync:get-scraped-chats', () => syncData.scrapedChats);
// Runtime Message Handler (Bridge for chrome.runtime.sendMessage)
ipcMain.handle('runtime:send-message', async (_event, message) => {
    // console.log('[Electron] Received runtime message:', message.type);

    switch (message.type) {
        case 'SEARCH_TABS':
            // Search in synced tabs
            const queryTabs = (message.query || '').toLowerCase();
            return {
                results: syncData.tabs
                    .filter(t => t.title?.toLowerCase().includes(queryTabs) || t.url?.toLowerCase().includes(queryTabs))
                    .map(t => ({
                        id: t.id,
                        title: t.title,
                        url: t.url,
                        description: 'Open Tab',
                        type: 'tab',
                        favicon: t.favIconUrl || t.favicon, // SyncOrchestrator sends favIconUrl
                        tabId: t.id
                    }))
                    .slice(0, 10)
            };

        case 'SEARCH_HISTORY':
            // Search in synced activity/history
            const queryHist = (message.query || '').toLowerCase();
            return {
                results: syncData.activity
                    .filter(a => a.title?.toLowerCase().includes(queryHist) || a.url?.toLowerCase().includes(queryHist))
                    .map(a => {
                        const timestamp = a.lastVisitTime || a.timestamp || Date.now();
                        return {
                            id: a.id || timestamp,
                            title: a.title || a.url, // Fallback to URL if title is missing
                            url: a.url,
                            // description: new Date(timestamp).toLocaleDateString(), // Don't show date
                            type: 'history',
                            favicon: a.favicon || a.favIconUrl
                        };
                    })
                    .slice(0, 10)
            };

        case 'SEARCH_BOOKMARKS':
            // Search in synced pins
            const queryBook = (message.query || '').toLowerCase();
            const pins = syncData.pins
                .filter(p => p.title?.toLowerCase().includes(queryBook))
                .map(p => ({
                    id: p.id || p.url,
                    title: p.title,
                    url: p.url,
                    type: 'bookmark',
                    favicon: p.favicon || p.icon
                }));
            return { results: pins.slice(0, 10) };

        case 'SEARCH_WORKSPACES':
            // Search in synced workspaces and their URLs
            const queryWs = (message.query || '').toLowerCase();
            const wsResults = [];

            // Search Workspace Names
            if (syncData.workspaces) {
                // 1. Workspace Containers
                syncData.workspaces.forEach(ws => {
                    if (ws.name?.toLowerCase().includes(queryWs)) {
                        wsResults.push({
                            id: ws.id,
                            title: ws.name,
                            description: `${(ws.urls || []).length} items`,
                            type: 'workspace',
                            favicon: null // Generic icon in UI
                        });
                    }

                    // 2. URLs inside Workspaces
                    if (ws.urls && Array.isArray(ws.urls)) {
                        ws.urls.forEach(u => {
                            const uTitle = (u.title || '').toLowerCase();
                            const uUrl = (u.url || '').toLowerCase();

                            if (uTitle.includes(queryWs) || uUrl.includes(queryWs)) {
                                wsResults.push({
                                    id: `${ws.id}_${u.url}`,
                                    title: u.title || new URL(u.url).hostname,
                                    url: u.url,
                                    description: `in ${ws.name}`,
                                    type: 'workspace-url',
                                    favicon: u.favicon || null,
                                    workspaceId: ws.id
                                });
                            }
                        });
                    }
                });
            }
            return { results: wsResults.slice(0, 20) };

        case 'NANO_AI_SEARCH':
            // Mock AI search for now, or just return items
            return { success: true, results: [] };

        case 'JUMP_TO_TAB':
            // Handle tab switching - broadcast to browser extensions via WebSocket
            console.log('[Electron] JUMP_TO_TAB request for tabId:', message.tabId);

            // Hide spotlight FIRST
            if (spotlightWindow && !spotlightWindow.isDestroyed()) {
                spotlightWindow.hide();
            }

            // On Windows, we need to bypass the foreground focus restriction
            // by simulating Alt key press and calling SetForegroundWindow on browser
            if (process.platform === 'win32') {
                // Focus the browser window directly using Windows API
                focusBrowserWindow().then(() => {
                    // Also broadcast to browser extension to activate the specific tab
                    broadcastToClients('jump-to-tab', {
                        tabId: message.tabId,
                        windowId: message.windowId
                    });
                });
            } else {
                // Non-Windows: just broadcast immediately
                broadcastToClients('jump-to-tab', {
                    tabId: message.tabId,
                    windowId: message.windowId
                });
            }

            return { success: true };

        case 'EXECUTE_COMMAND':
            console.log('[Electron] Execute command:', message.commandValue);
            return { success: true };

        case 'SPOTLIGHT_HIDE':
            spotlightWindow?.hide();
            return { ok: true };

        case 'SEARCH_APPS':
            // Search running and installed apps
            const queryApps = (message.query || '').toLowerCase();
            if (!queryApps || queryApps.length < 2) {
                return { results: [] };
            }

            try {
                const [running, installed] = await Promise.all([
                    getRunningApps(),
                    getInstalledApps()
                ]);

                // Dedupe: don't show installed if already running
                const runningNames = new Set(running.map(a => a.name?.toLowerCase()));

                const runningMatches = running
                    .filter(a => a.name?.toLowerCase().includes(queryApps) ||
                                 a.title?.toLowerCase().includes(queryApps))
                    .slice(0, 5);

                const installedMatches = installed
                    .filter(a => a.name?.toLowerCase().includes(queryApps) &&
                                 !runningNames.has(a.name?.toLowerCase()))
                    .slice(0, 5);

                return { results: [...runningMatches, ...installedMatches] };
            } catch (e) {
                console.error('[Electron] SEARCH_APPS failed:', e.message);
                return { results: [] };
            }

        default:
            // console.log('[Electron] Runtime message received:', message);
            return { success: false, error: 'Unknown message type' };
    }
});

// ==========================================
// APP DISCOVERY IPC HANDLERS
// ==========================================

ipcMain.handle('get-running-apps', async () => {
    try {
        return await getRunningApps();
    } catch (e) {
        console.warn('[Electron] get-running-apps failed:', e.message);
        return [];
    }
});

ipcMain.handle('get-installed-apps', async () => {
    try {
        return await getInstalledApps();
    } catch (e) {
        console.warn('[Electron] get-installed-apps failed:', e.message);
        return [];
    }
});

ipcMain.handle('focus-app', async (_event, pid) => {
    try {
        return await focusAppWindow(pid);
    } catch (e) {
        console.warn('[Electron] focus-app failed:', e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('launch-app', async (_event, appPath) => {
    try {
        return await launchApp(appPath);
    } catch (e) {
        console.warn('[Electron] launch-app failed:', e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('sync:set-scraped-chats', (_event, data) => {
    syncData.scrapedChats = Array.isArray(data) ? data : [];
    syncData.lastUpdated.scrapedChats = Date.now();
    saveData();
    broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
    return { ok: true };
});

ipcMain.handle('sync:get-scraped-configs', () => syncData.scrapedConfigs);
ipcMain.handle('sync:set-scraped-configs', (_event, data) => {
    syncData.scrapedConfigs = Array.isArray(data) ? data : [];
    syncData.lastUpdated.scrapedConfigs = Date.now();
    saveData();
    broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
    return { ok: true };
});

ipcMain.handle('sync:get-daily-memory', () => syncData.dailyMemory);
ipcMain.handle('sync:set-daily-memory', (_event, data) => {
    syncData.dailyMemory = Array.isArray(data) ? data : [];
    syncData.lastUpdated.dailyMemory = Date.now();
    saveData();
    broadcastToClients('daily-memory-updated', syncData.dailyMemory);
    return { ok: true };
});

ipcMain.handle('sync:set-ui-state', (_event, data) => {
    syncData.uiState = { ...syncData.uiState, ...data };
    saveData();
    broadcastToClients('ui-state-updated', syncData.uiState);
    return { ok: true };
});
ipcMain.handle('sync:get-ui-state', () => syncData.uiState);

ipcMain.handle('sync:get-dashboard', () => syncData.dashboard);
ipcMain.handle('sync:set-dashboard', (_event, data) => {
    syncData.dashboard = { ...syncData.dashboard, ...data };
    saveData();
    broadcastToClients('dashboard-updated', syncData.dashboard);
    return { ok: true };
});

ipcMain.handle('sync:get-tabs', () => syncData.tabs);
ipcMain.handle('sync:set-tabs', (_event, data) => {
    syncData.tabs = Array.isArray(data) ? data : [];
    syncData.lastUpdated.tabs = Date.now();
    // saveData(); // Optional
    broadcastToClients('tabs-updated', syncData.tabs);
    return { ok: true };
});

ipcMain.handle('sync:trigger-full', () => {
    // Trigger full sync by broadcasting current state
    broadcastToClients('sync-state', {
        workspaces: syncData.workspaces,
        urls: syncData.urls,
        settings: syncData.settings,
        tabs: syncData.tabs,
        notes: syncData.notes,
        urlNotes: syncData.urlNotes,
        pins: syncData.pins,
        scrapedChats: syncData.scrapedChats,
        scrapedConfigs: syncData.scrapedConfigs,
        dailyMemory: syncData.dailyMemory,
        uiState: syncData.uiState,
        lastUpdated: syncData.lastUpdated
    });
    return { ok: true, lastUpdated: syncData.lastUpdated };
});

// System handlers
ipcMain.handle('get-app-path', () => app.getPath('userData'));
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('open-external', (_event, url) => {
    if (url && typeof url === 'string') {
        shell.openExternal(url);
        return { ok: true };
    }
    return { ok: false, error: 'Invalid URL' };
});

ipcMain.handle('focus-window', (_event, pid) => {
    // Focus window is not directly supported in Electron
    // Could use native modules like 'node-window-manager' if needed
    console.log('[Electron] Focus window requested for PID:', pid);
    return { ok: false, error: 'Not implemented' };
});

ipcMain.handle('get-processes', () => {
    // Return empty array - could integrate with system process list
    return [];
});



// ==========================================
// APP LIFECYCLE
// ==========================================

// Global shortcut configuration
const SPOTLIGHT_SHORTCUT = 'Alt+K';

function registerSpotlightShortcut() {
    // Unregister first to avoid conflicts
    if (globalShortcut.isRegistered(SPOTLIGHT_SHORTCUT)) {
        globalShortcut.unregister(SPOTLIGHT_SHORTCUT);
    }

    const success = globalShortcut.register(SPOTLIGHT_SHORTCUT, () => {
        console.log('[Electron] Global shortcut triggered:', SPOTLIGHT_SHORTCUT);
        toggleSpotlight();
    });

    if (!success) {
        console.error(`[Electron] Global shortcut registration failed for ${SPOTLIGHT_SHORTCUT}`);
        return false;
    }

    console.log(`[Electron] Global shortcut registered: ${SPOTLIGHT_SHORTCUT}`);
    return true;
}

app.whenReady().then(() => {
    // Load persisted data
    loadData();

    // Start HTTP server for extension sync
    startHttpServer();

    // Create main window
    createWindow();
    createSpotlightWindow();

    // Register Global Shortcut with retry
    if (!registerSpotlightShortcut()) {
        // Retry after a short delay if initial registration fails
        setTimeout(() => {
            console.log('[Electron] Retrying shortcut registration...');
            registerSpotlightShortcut();
        }, 1000);
    }

    // Re-register shortcut periodically to ensure it stays active
    // Windows can sometimes "steal" global shortcuts
    setInterval(() => {
        if (!globalShortcut.isRegistered(SPOTLIGHT_SHORTCUT)) {
            console.log('[Electron] Shortcut was unregistered, re-registering...');
            registerSpotlightShortcut();
        }
    }, 5000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Unregister all shortcuts
    globalShortcut.unregisterAll();

    // Save data before quitting
    saveData();

    // Close HTTP server
    if (httpServer) {
        httpServer.close();
    }
});

// ==========================================
// SINGLE INSTANCE LOCK
// ==========================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('[Electron] Another instance is running, quitting...');
    app.quit();
} else {
    app.on('second-instance', () => {
        // Focus main window if user tries to open another instance
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Log startup
console.log('[Electron] App starting...');
console.log('[Electron] User data path:', app.getPath('userData'));
