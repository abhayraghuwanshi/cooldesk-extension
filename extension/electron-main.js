/**
 * Electron Main Process
 * This file creates and manages the desktop application window
 * Includes HTTP server for browser extension sync and IPC handlers
 */

import { exec } from 'child_process';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import open from 'open';
import { basename, dirname, join } from 'path';
import psList from 'ps-list';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { WebSocketServer } from 'ws';

// Local LLM imports (lazy loaded)
let localLLM = null;

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;

// ==========================================
// WINDOWS FOCUS HELPER
// ==========================================

/**
 * Focus browser window using compiled BrowserFocus.exe (FAST ~30-50ms)
 * This is 6-10x faster than PowerShell Add-Type approach
 */
function focusBrowserWindow() {
    if (process.platform !== 'win32') return Promise.resolve();

    let exePath;
    if (app.isPackaged) {
        exePath = join(process.resourcesPath, 'BrowserFocus.exe');
    } else {
        exePath = join(__dirname, 'BrowserFocus.exe');
    }

    // console.log('[Electron] Attempting to focus browser using:', exePath);

    return new Promise((resolve) => {
        // Check existence first
        if (!existsSync(exePath)) {
            console.warn('[Electron] BrowserFocus.exe not found at:', exePath);
            resolve();
            return;
        }

        exec(`"${exePath}"`, { windowsHide: true, timeout: 2000 }, (error, stdout, stderr) => {
            if (error) {
                console.warn('[Electron] Focus browser failed:', error.message);
                if (stderr) console.warn('[Electron] Stderr:', stderr);
            } else {
                // console.log('[Electron] Focus browser success');
            }
            resolve();
        });
    });
}
// ...


// ==========================================
// CROSS-PLATFORM APP DISCOVERY
// ==========================================

// Installed apps cache (in-memory + persistent disk cache)
let installedAppsCache = null;
let installedAppsCacheTime = 0;
const INSTALLED_APPS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours - apps rarely change
const INSTALLED_APPS_CACHE_FILE = join(app.getPath('userData'), 'installed-apps-cache.json');
const INSTALLED_APPS_CACHE_VERSION = 2; // Increment when filter logic changes to invalidate old caches

/**
 * Load installed apps from disk cache
 */
function loadInstalledAppsFromDisk() {
    try {
        if (existsSync(INSTALLED_APPS_CACHE_FILE)) {
            const data = JSON.parse(readFileSync(INSTALLED_APPS_CACHE_FILE, 'utf8'));
            // Check version to invalidate old caches when filter changes
            if (data.version !== INSTALLED_APPS_CACHE_VERSION) {
                console.log(`[Electron] Disk cache version mismatch (${data.version} vs ${INSTALLED_APPS_CACHE_VERSION}), will rescan`);
                return false;
            }
            if (data.apps && data.timestamp && (Date.now() - data.timestamp) < INSTALLED_APPS_CACHE_TTL) {
                console.log(`[Electron] Loaded ${data.apps.length} installed apps from disk cache (v${data.version})`);
                installedAppsCache = data.apps;
                installedAppsCacheTime = data.timestamp;
                return true;
            }
        }
    } catch (e) {
        console.warn('[Electron] Failed to load installed apps from disk cache:', e.message);
    }
    return false;
}

/**
 * Save installed apps to disk cache
 */
function saveInstalledAppsToDisk(apps) {
    try {
        const data = {
            apps,
            timestamp: Date.now(),
            platform: process.platform,
            version: INSTALLED_APPS_CACHE_VERSION
        };
        writeFileSync(INSTALLED_APPS_CACHE_FILE, JSON.stringify(data), 'utf8');
        console.log(`[Electron] Saved ${apps.length} installed apps to disk cache (v${INSTALLED_APPS_CACHE_VERSION})`);
    } catch (e) {
        console.warn('[Electron] Failed to save installed apps to disk cache:', e.message);
    }
}

// Try to load from disk cache on startup
loadInstalledAppsFromDisk();

// ==========================================
// CHANGE DETECTION FOR SYNC
// ==========================================

// Hash tracking to avoid broadcasting unchanged data
const lastBroadcastHash = {};

/**
 * Simple hash function for change detection
 */
function simpleHash(data) {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
}

/**
 * Check if data has changed since last broadcast
 * Returns true if changed, false if same
 */
function hasDataChanged(type, data) {
    const currentHash = simpleHash(data);
    const lastHash = lastBroadcastHash[type];
    if (currentHash === lastHash) {
        return false;
    }
    lastBroadcastHash[type] = currentHash;
    return true;
}

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

        // Deduplicate by app name - only keep one instance per app
        // Use a Map to track unique apps by lowercase name
        const uniqueApps = new Map();

        for (const p of procArray) {
            if (!p.Name || !p.MainWindowTitle) continue;

            const appKey = p.Name.toLowerCase();

            // Skip system processes and helper processes
            if (appKey.includes('helper') || appKey.includes('renderer') ||
                appKey.includes('gpu') || appKey.includes('crashpad') ||
                appKey.includes('utility') || appKey.includes('broker')) {
                continue;
            }

            // Only keep the first instance (or one with a better title)
            if (!uniqueApps.has(appKey)) {
                uniqueApps.set(appKey, {
                    id: `app-${p.Id}`,
                    pid: p.Id,
                    title: p.MainWindowTitle || p.Name,
                    name: p.Name,
                    path: p.Path || '',
                    type: 'app',
                    isRunning: true
                });
            } else {
                // If this instance has a longer/better title, use it instead
                const existing = uniqueApps.get(appKey);
                if (p.MainWindowTitle && p.MainWindowTitle.length > existing.title.length) {
                    uniqueApps.set(appKey, {
                        id: `app-${p.Id}`,
                        pid: p.Id,
                        title: p.MainWindowTitle,
                        name: p.Name,
                        path: p.Path || existing.path,
                        type: 'app',
                        isRunning: true
                    });
                }
            }
        }

        const apps = Array.from(uniqueApps.values());
        console.log('[Electron] getRunningAppsWindows: found', apps.length, 'unique apps:', apps.map(a => a.name));

        // Fetch icons for running apps (in parallel batches)
        const BATCH_SIZE = 10;
        for (let i = 0; i < apps.length; i += BATCH_SIZE) {
            const batch = apps.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (appItem) => {
                try {
                    if (appItem.path && existsSync(appItem.path)) {
                        const icon = await app.getFileIcon(appItem.path);
                        if (!icon.isEmpty()) {
                            appItem.icon = icon.toDataURL();
                        }
                    }
                } catch (e) {
                    // Ignore icon fetch errors
                }
            }));
        }

        return apps;
    } catch (e) {
        console.error('[Electron] getRunningAppsWindows error:', e.message);
        return [];
    }
}

/**
 * Get the currently active window (cross-platform)
 */
async function getActiveWindow() {
    const platform = process.platform;
    try {
        if (platform === 'win32') {
            return await getActiveWindowWindows();
        } else if (platform === 'darwin') {
            // macOS implementation can be added later
            return null;
        } else {
            // Linux implementation can be added later
            return null;
        }
    } catch (e) {
        console.warn('[Electron] getActiveWindow failed:', e.message);
        return null;
    }
}

/**
 * Windows: Get active window using PowerShell
 */
async function getActiveWindowWindows() {
    const psScript = `
        $code = @'
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
        '@
        $Win32 = Add-Type -MemberDefinition $code -Name "Win32" -Namespace Win32 -PassThru
        $hwnd = $Win32::GetForegroundWindow()
        $pidVar = 0
        $Win32::GetWindowThreadProcessId($hwnd, [ref]$pidVar)
        $process = Get-Process -Id $pidVar
        $obj = @{
            name = $process.Name
            title = $process.MainWindowTitle
            pid = $process.Id
            path = $process.Path
        }
        $obj | ConvertTo-Json
    `;

    const b64Script = Buffer.from(psScript, 'utf16le').toString('base64');

    try {
        const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${b64Script}`, { windowsHide: true });
        if (!stdout || stdout.trim() === '') return null;
        return JSON.parse(stdout);
    } catch (e) {
        return null;
    }
}

// Track last active app to calculate duration
let lastActiveApp = null;
let lastActiveTime = Date.now();
let lastNotifiedApp = null; // Track last notified app to avoid spam
const TRACKING_INTERVAL_MS = 5000;
const ACTIVITY_BATCH_INTERVAL_MS = 30000; // Only notify renderers every 30s

/**
 * Start tracking desktop application usage
 */
function startAppActivityTracking() {
    console.log('[Electron] Starting desktop activity tracking...');

    let pendingActivities = [];
    let lastBatchTime = Date.now();

    setInterval(async () => {
        const now = Date.now();
        const activeWindow = await getActiveWindow();

        if (activeWindow) {
            const { name, title, path } = activeWindow;

            // Avoid double counting if the active app IS the browser (Chrome/Edge)
            // The extension is already tracking browser tabs.
            const browserNames = ['chrome', 'msedge', 'firefox', 'brave', 'opera'];
            if (browserNames.includes(name.toLowerCase())) {
                return;
            }

            const appActivity = {
                id: `activity-${now}`,
                url: path || name,
                title: title || name,
                time: TRACKING_INTERVAL_MS,
                timestamp: now,
                type: 'app',
                favicon: '',
                appName: name
            };

            // Push to syncData (always track internally)
            syncData.activity.push(appActivity);

            // Keep array size manageable
            if (syncData.activity.length > 1000) {
                syncData.activity = syncData.activity.slice(-1000);
            }

            syncData.lastUpdated.activity = now;

            // Batch activities for notification
            pendingActivities.push(appActivity);

            // Only notify renderers in batches OR when app changes
            const appChanged = lastNotifiedApp !== name;
            const batchReady = (now - lastBatchTime) >= ACTIVITY_BATCH_INTERVAL_MS;

            if (appChanged || batchReady) {
                if (pendingActivities.length > 0) {
                    // Persist once per batch
                    saveData();

                    // Notify renderers with batched activities
                    notifyRenderer('activity-updated', pendingActivities);
                    broadcastToClients('activity-updated', pendingActivities);

                    pendingActivities = [];
                    lastBatchTime = now;
                    lastNotifiedApp = name;
                }
            }
        }
    }, TRACKING_INTERVAL_MS);
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
    // Return cached if fresh (memory cache checked first, then disk was loaded on startup)
    if (installedAppsCache && installedAppsCache.length > 0 && Date.now() - installedAppsCacheTime < INSTALLED_APPS_CACHE_TTL) {
        console.log(`[Electron] getInstalledApps: returning ${installedAppsCache.length} cached apps`);
        return installedAppsCache;
    }

    const platform = process.platform;
    let apps = [];

    console.log(`[Electron] getInstalledApps: fetching for platform ${platform}... (this may take a few seconds on first run)`);

    try {
        if (platform === 'win32') {
            apps = await getInstalledAppsWindows();
        } else if (platform === 'darwin') {
            apps = await getInstalledAppsMac();
        } else {
            apps = await getInstalledAppsLinux();
        }
        console.log(`[Electron] getInstalledApps: found ${apps.length} apps`);

        // Save to disk cache for next startup
        saveInstalledAppsToDisk(apps);
    } catch (e) {
        console.warn('[Electron] getInstalledApps failed:', e.message);
    }

    installedAppsCache = apps;
    installedAppsCacheTime = Date.now();
    return apps;
}

/**
 * Filter out system/utility apps that users don't typically launch
 */
function filterUserApps(apps) {
    // Patterns for apps to exclude (case-insensitive)
    const excludePatterns = [
        // System/Windows components
        /^microsoft\s*(edge\s*)?update/i,
        /^windows\s*(app|sdk|kit|installer|defender)/i,
        /^microsoft\s*(visual\s*c\+\+|\.net|asp\.net|web)/i,
        /^\.net\s*(runtime|desktop|host|framework)/i,
        /^vc_?redist/i,
        /^msvc/i,
        /^vcredist/i,

        // Runtimes and frameworks
        /^java\s*(tm|se|runtime|development|update)/i,
        /^oracle\s*java/i,
        /^node\.?js/i,
        /^python\s*\d/i,
        /^php\s*\d/i,
        /^ruby\s*\d/i,
        /^go\s*programming/i,
        /^rust\s*(programming)?/i,

        // Package managers and dev tools (unless main app)
        /^npm/i,
        /^chocolatey/i,
        /^winget/i,
        /^scoop/i,
        /^pip\s/i,

        // Drivers and hardware
        /driver/i,
        /^nvidia\s*(graphics|physx|geforce\s*experience)/i,
        /^amd\s*(radeon|software|chipset)/i,
        /^intel\s*(graphics|management|rapid|wireless)/i,
        /^realtek/i,
        /^synaptics/i,
        /^logitech\s*(unifying|options|gaming)/i,

        // Updaters, helpers, services
        /update(r|service)?$/i,
        /helper$/i,
        /^helper\s/i,
        /service$/i,
        /^service\s/i,
        /uninstall/i,
        /^setup\s/i,
        /installer$/i,
        /redistributable/i,
        /runtime$/i,
        /^repair\s/i,
        /^remove\s/i,

        // Microsoft Office components (not main apps)
        /^microsoft\s*(office\s*)?(click-to-run|onenote\s*for)/i,
        /^office\s*\d+\s*(click|upload|telemetry)/i,

        // Common bloatware/utilities
        /^bonjour/i,
        /^apple\s*(mobile\s*device|software\s*update|application)/i,
        /^adobe\s*(creative\s*cloud|genuine|arm|flash)/i,
        /^autodesk\s*(genuine|desktop)/i,

        // Browser components (not main browsers)
        /^google\s*update/i,
        /^chrome\s*components/i,
        /^firefox\s*maintenance/i,

        // Repair tools and diagnostics
        /diagnostic/i,
        /troubleshoot/i,
        /^repair\s/i,

        // Very short or cryptic names (likely internal tools)
        /^[a-z]{1,3}$/i,
        /^[0-9]+$/,

        // SDK and development tools users don't launch directly
        /\bsdk\b/i,
        /\bapi\b/i,
        /^tools\s*for/i,
        /\bcomponent\b/i,
    ];

    // Names to always include (popular apps that might match exclude patterns)
    const alwaysInclude = [
        /^visual\s*studio\s*(code|community|professional|enterprise)?$/i,
        /^vs\s*code$/i,
        /^android\s*studio$/i,
        /^intellij/i,
        /^pycharm/i,
        /^webstorm/i,
        /^rider$/i,
        /^datagrip/i,
        /^node\.js\s*command/i,  // Node.js command prompt is useful
        /^git\s*(bash|gui|cmd)/i,
        /^github\s*desktop/i,
        /^docker\s*desktop/i,
        /^postman/i,
        /^insomnia/i,
        /^figma/i,
        /^adobe\s*(photoshop|illustrator|premiere|after\s*effects|xd|acrobat|lightroom)/i,
        /^microsoft\s*(word|excel|powerpoint|outlook|teams|onenote|access|publisher|visio)$/i,
        /^office\s*(word|excel|powerpoint)/i,
        /^google\s*(chrome|drive|earth)$/i,
        /^mozilla\s*firefox$/i,
        /^brave\s*browser/i,
        /^opera\s*(browser|gx)?$/i,
        /^microsoft\s*edge$/i,
        /^discord$/i,
        /^slack$/i,
        /^zoom$/i,
        /^spotify$/i,
        /^steam$/i,
        /^epic\s*games/i,
        /^origin$/i,
        /^battle\.net/i,
        /^vlc/i,
        /^obs\s*studio/i,
        /^audacity/i,
        /^gimp/i,
        /^blender/i,
        /^unity\s*(hub|editor)?$/i,
        /^unreal\s*(engine|editor)/i,
        /^notion$/i,
        /^obsidian$/i,
        /^todoist/i,
        /^1password/i,
        /^bitwarden/i,
        /^lastpass/i,
        /^keepass/i,
    ];

    const beforeCount = apps.length;
    const filtered = apps.filter(app => {
        const name = app.name || app.title || '';
        if (!name || name.length < 2) return false;

        // Check if always include first
        if (alwaysInclude.some(pattern => pattern.test(name))) {
            return true;
        }

        // Check if should exclude
        if (excludePatterns.some(pattern => pattern.test(name))) {
            return false;
        }

        // Include by default
        return true;
    });

    console.log(`[Electron] filterUserApps: ${beforeCount} -> ${filtered.length} apps (removed ${beforeCount - filtered.length} system/utility apps)`);
    return filtered;
}

/**
 * Windows: Get installed apps from common locations
 * Uses AppScanner.exe for fast native scanning (~50ms vs 2-3s PowerShell)
 */
async function getInstalledAppsWindows() {
    // Return cached if fresh
    const now = Date.now();
    if (installedAppsCache && (now - installedAppsCacheTime) < INSTALLED_APPS_CACHE_TTL) {
        console.log('[Electron] getInstalledAppsWindows: returning cached', installedAppsCache.length, 'apps');
        return installedAppsCache;
    }

    console.log('[Electron] getInstalledAppsWindows: scanning...');
    const startTime = performance.now();

    // Try AppScanner.exe first (fastest, ~50ms)
    let exePath;
    if (app.isPackaged) {
        exePath = join(process.resourcesPath, 'AppScanner.exe');
    } else {
        exePath = join(__dirname, 'AppScanner.exe');
    }

    if (existsSync(exePath)) {
        try {
            const { stdout } = await execAsync(`"${exePath}"`, {
                windowsHide: true,
                timeout: 10000,
                maxBuffer: 10 * 1024 * 1024
            });

            if (stdout && stdout.trim()) {
                const rawApps = JSON.parse(stdout);
                if (Array.isArray(rawApps) && rawApps.length > 0) {
                    const apps = filterUserApps(rawApps);
                    installedAppsCache = apps;
                    installedAppsCacheTime = now;
                    console.log(`[Electron] AppScanner.exe found ${rawApps.length} raw apps, filtered to ${apps.length} user apps in ${(performance.now() - startTime).toFixed(0)}ms`);
                    return apps;
                }
            }
        } catch (e) {
            console.warn('[Electron] AppScanner.exe failed:', e.message);
        }
    }

    // Fallback: inline directory scanning (if exe not available)
    console.log('[Electron] Falling back to directory scanning...');
    const apps = new Map();

    const programDirs = [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        join(process.env.LOCALAPPDATA || '', 'Programs')
    ].filter(Boolean);

    for (const dir of programDirs) {
        try {
            if (!existsSync(dir)) continue;
            for (const entry of readdirSync(dir)) {
                try {
                    const fullPath = join(dir, entry);
                    if (!statSync(fullPath).isDirectory()) continue;

                    const exeFiles = readdirSync(fullPath)
                        .filter(f => f.endsWith('.exe') && !/unins|update|crash|helper|setup/i.test(f));

                    if (exeFiles.length > 0) {
                        const mainExe = exeFiles.find(e =>
                            e.toLowerCase().replace('.exe', '') === entry.toLowerCase()
                        ) || exeFiles[0];

                        if (!apps.has(entry.toLowerCase())) {
                            apps.set(entry.toLowerCase(), {
                                id: `installed-${entry}`,
                                name: entry,
                                title: entry,
                                path: join(fullPath, mainExe),
                                type: 'app',
                                isRunning: false
                            });
                        }
                    }
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
    }

    const rawResult = Array.from(apps.values()).sort((a, b) => a.name.localeCompare(b.name));
    const result = filterUserApps(rawResult);
    installedAppsCache = result;
    installedAppsCacheTime = now;
    console.log(`[Electron] getInstalledAppsWindows: found ${rawResult.length} raw apps, filtered to ${result.length} user apps in ${(performance.now() - startTime).toFixed(0)}ms`);
    return result;
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
 * Windows: Focus window using compiled AppFocus.exe (FAST ~30-50ms)
 * This is 6-10x faster than PowerShell Add-Type approach
 */
async function focusAppWindowWindows(pid) {
    let exePath;
    if (app.isPackaged) {
        exePath = join(process.resourcesPath, 'AppFocus.exe');
    } else {
        exePath = join(__dirname, 'AppFocus.exe');
    }

    try {
        await execAsync(`"${exePath}" ${pid}`, {
            windowsHide: true,
            timeout: 1000
        });
        return { success: true };
    } catch (e) {
        console.warn('[Electron] Focus failed:', e.message);
        return { success: false, error: e.message };
    }
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
    // Tabs stored per device: Map<deviceId, Tab[]>
    // Note: This Map is NOT persisted to disk (tabs are transient)
    // It's reconstructed from connected browser extensions on startup
    deviceTabsMap: new Map(),
    tabs: [], // Aggregated view of all device tabs
    lastUpdated: {}
};

/**
 * Recompute aggregated tabs from deviceTabsMap
 */
function recomputeAggregatedTabs() {
    // Safety check: ensure deviceTabsMap is a proper Map
    if (!(syncData.deviceTabsMap instanceof Map)) {
        console.warn('[Electron] deviceTabsMap was not a Map, reinitializing...');
        syncData.deviceTabsMap = new Map();
    }

    const allTabs = [];
    for (const [deviceId, devTabs] of syncData.deviceTabsMap.entries()) {
        // Add deviceId to each tab for tracking
        const tabsWithDevice = devTabs.map(t => ({ ...t, _deviceId: deviceId }));
        allTabs.push(...tabsWithDevice);
    }
    syncData.tabs = allTabs;
    syncData.lastUpdated.tabs = Date.now();
    console.log(`[Electron] Recomputed tabs: ${allTabs.length} total from ${syncData.deviceTabsMap.size} devices`);
    return allTabs;
}

// Load persisted data on startup
function loadData() {
    try {
        if (existsSync(DATA_FILE)) {
            const content = readFileSync(DATA_FILE, 'utf-8');
            const loaded = JSON.parse(content);
            // Merge with default structure to ensure all keys exist
            // BUT preserve deviceTabsMap as a Map (it's not persisted)
            const preservedMap = syncData.deviceTabsMap;
            syncData = { ...syncData, ...loaded };
            // Restore the Map - it gets destroyed by JSON parse/spread
            syncData.deviceTabsMap = preservedMap;
            // Also ensure tabs array is fresh (will be populated by connected browsers)
            syncData.tabs = [];
            console.log('[Electron] Loaded sync data from disk (deviceTabsMap preserved as Map)');
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
        console.log(`[Electron] Notifying renderer: ${channel}, data length:`, Array.isArray(data) ? data.length : 'object');
        mainWindow.webContents.send(channel, data);
    } else {
        console.warn(`[Electron] Cannot notify renderer (${channel}): mainWindow is ${mainWindow ? 'destroyed' : 'null'}`);
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
        console.log('[Electron] WebSocket client connected. Total clients:', wss.clients.size);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                console.log('[Electron WS] Received message type:', data.type);
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

        case '/debug/tabs':
            // Debug endpoint to see tab sync status per device
            const devicesInfo = {};
            for (const [deviceId, tabs] of syncData.deviceTabsMap.entries()) {
                devicesInfo[deviceId] = {
                    count: tabs.length,
                    sample: tabs.slice(0, 2).map(t => ({ id: t.id, title: t.title?.substring(0, 50) }))
                };
            }
            res.writeHead(200);
            res.end(JSON.stringify({
                totalTabs: syncData.tabs.length,
                devicesConnected: syncData.deviceTabsMap.size,
                devices: devicesInfo,
                lastUpdated: syncData.lastUpdated.tabs
            }, null, 2));
            break;

        default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
    }
}

function handlePostRequest(path, data, res) {
    switch (path) {
        case '/workspaces':
            // Use name-based merge for workspaces to handle multi-browser sync
            const incomingWorkspaces = Array.isArray(data) ? data : [];
            syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, incomingWorkspaces);
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
            // data can be [tabs] or { deviceId, tabs }
            let httpTabs = [];
            let httpDeviceId = 'http-unknown';

            if (Array.isArray(data)) {
                httpTabs = data;
            } else if (data && Array.isArray(data.tabs)) {
                httpTabs = data.tabs;
                httpDeviceId = data.deviceId || 'http-unknown';
            }

            console.log(`[Electron HTTP] Received tabs from device: ${httpDeviceId}, count: ${httpTabs.length}`);

            // Store tabs for this device
            syncData.deviceTabsMap.set(httpDeviceId, httpTabs);

            // Recompute aggregated tabs
            recomputeAggregatedTabs();

            // We don't save tabs to disk to avoid stale sessions on restart
            // saveData();

            notifyRenderer('tabs-updated', syncData.tabs);
            broadcastToClients('tabs-updated', syncData.tabs);
            res.writeHead(204);
            res.end();
            break;

        case '/sync':
            // Full sync request - merge incoming data
            if (data.workspaces) {
                // Use name-based merge for workspaces to handle multi-browser sync
                syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, data.workspaces);
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
            // Use name-based merge for workspaces to handle multi-browser sync
            syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, payload);
            syncData.lastUpdated.workspaces = Date.now();
            // Only broadcast if data actually changed
            if (hasDataChanged('workspaces', syncData.workspaces)) {
                saveData();
                notifyRenderer('workspaces-updated', syncData.workspaces);
                broadcastToClients('workspaces-updated', syncData.workspaces);
            }
            break;

        case 'push-urls':
            syncData.urls = payload;
            syncData.lastUpdated.urls = Date.now();
            if (hasDataChanged('urls', syncData.urls)) {
                saveData();
                notifyRenderer('urls-updated', syncData.urls);
                broadcastToClients('urls-updated', syncData.urls);
            }
            break;

        case 'push-settings':
            syncData.settings = { ...syncData.settings, ...payload };
            syncData.lastUpdated.settings = Date.now();
            if (hasDataChanged('settings', syncData.settings)) {
                saveData();
                notifyRenderer('settings-updated', syncData.settings);
                broadcastToClients('settings-updated', syncData.settings);
            }
            break;

        case 'push-dashboard':
            syncData.dashboard = payload;
            if (hasDataChanged('dashboard', syncData.dashboard)) {
                saveData();
                notifyRenderer('dashboard-updated', syncData.dashboard);
                broadcastToClients('dashboard-updated', syncData.dashboard);
            }
            break;

        case 'push-tabs':
            // payload can be [tabs] or { deviceId, tabs }
            let wsTabs = [];
            let wsDeviceId = 'ws-unknown';

            if (Array.isArray(payload)) {
                wsTabs = payload;
            } else if (payload && Array.isArray(payload.tabs)) {
                wsTabs = payload.tabs;
                wsDeviceId = payload.deviceId || 'ws-unknown';
            }

            console.log(`[Electron WS] Received push-tabs from ${wsDeviceId} with ${wsTabs.length} tabs`);

            // Safety: ensure deviceTabsMap is a Map
            if (!(syncData.deviceTabsMap instanceof Map)) {
                console.warn('[Electron WS] deviceTabsMap was corrupted, reinitializing...');
                syncData.deviceTabsMap = new Map();
            }

            // Store tabs for this device
            syncData.deviceTabsMap.set(wsDeviceId, wsTabs);

            // Recompute aggregated tabs
            recomputeAggregatedTabs();

            // We don't save tabs to disk to avoid stale sessions on restart
            // saveData();

            // Only broadcast if tabs actually changed
            if (hasDataChanged('tabs', syncData.tabs)) {
                notifyRenderer('tabs-updated', syncData.tabs);
                broadcastToClients('tabs-updated', syncData.tabs);
            }
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
            if (hasDataChanged('notes', syncData.notes)) {
                saveData();
                notifyRenderer('notes-updated', syncData.notes);
                broadcastToClients('notes-updated', syncData.notes);
            }
            break;

        case 'push-url-notes':
            syncData.urlNotes = payload;
            syncData.lastUpdated.urlNotes = Date.now();
            if (hasDataChanged('urlNotes', syncData.urlNotes)) {
                saveData();
                notifyRenderer('url-notes-updated', syncData.urlNotes);
                broadcastToClients('url-notes-updated', syncData.urlNotes);
            }
            break;

        case 'push-pins':
            syncData.pins = payload;
            syncData.lastUpdated.pins = Date.now();
            if (hasDataChanged('pins', syncData.pins)) {
                saveData();
                notifyRenderer('pins-updated', syncData.pins);
                broadcastToClients('pins-updated', syncData.pins);
            }
            break;

        case 'push-scraped-chats':
            syncData.scrapedChats = payload;
            syncData.lastUpdated.scrapedChats = Date.now();
            if (hasDataChanged('scrapedChats', syncData.scrapedChats)) {
                saveData();
                notifyRenderer('scraped-chats-updated', syncData.scrapedChats);
                broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
            }
            break;

        case 'push-scraped-configs':
            syncData.scrapedConfigs = payload;
            syncData.lastUpdated.scrapedConfigs = Date.now();
            if (hasDataChanged('scrapedConfigs', syncData.scrapedConfigs)) {
                saveData();
                notifyRenderer('scraped-configs-updated', syncData.scrapedConfigs);
                broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
            }
            break;

        case 'push-daily-memory':
            syncData.dailyMemory = payload;
            syncData.lastUpdated.dailyMemory = Date.now();
            if (hasDataChanged('dailyMemory', syncData.dailyMemory)) {
                saveData();
                notifyRenderer('daily-memory-updated', syncData.dailyMemory);
                broadcastToClients('daily-memory-updated', syncData.dailyMemory);
            }
            break;

        case 'push-ui-state':
            syncData.uiState = { ...syncData.uiState, ...payload };
            if (hasDataChanged('uiState', syncData.uiState)) {
                saveData();
                notifyRenderer('ui-state-updated', syncData.uiState);
                broadcastToClients('ui-state-updated', syncData.uiState);
            }
            break;

        // ==========================================
        // LLM WebSocket Handlers (for browser extension)
        // ==========================================
        case 'llm-get-status':
            getLocalLLM().then(llm => {
                ws.send(JSON.stringify({ type: 'llm-status', payload: llm.getStatus() }));
            }).catch(err => {
                ws.send(JSON.stringify({ type: 'llm-status', payload: { error: err.message } }));
            });
            break;

        case 'llm-get-models':
            getLocalLLM().then(llm => {
                ws.send(JSON.stringify({ type: 'llm-models', payload: llm.getAvailableModels() }));
            }).catch(err => {
                ws.send(JSON.stringify({ type: 'llm-models', payload: { error: err.message } }));
            });
            break;

        case 'llm-load-model':
            getLocalLLM().then(async llm => {
                try {
                    await llm.loadModel(payload.modelName);
                    ws.send(JSON.stringify({ type: 'llm-model-loaded', payload: { ok: true } }));
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'llm-model-loaded', payload: { ok: false, error: err.message } }));
                }
            });
            break;

        case 'llm-chat':
            getLocalLLM().then(async llm => {
                try {
                    const response = await llm.chat(payload.prompt, payload.options || {});
                    ws.send(JSON.stringify({
                        type: 'llm-chat-response',
                        payload: { ok: true, response, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-chat-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-summarize':
            getLocalLLM().then(async llm => {
                try {
                    const summary = await llm.summarize(payload.text, payload.maxLength || 3);
                    ws.send(JSON.stringify({
                        type: 'llm-summarize-response',
                        payload: { ok: true, summary, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-summarize-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-categorize':
            getLocalLLM().then(async llm => {
                try {
                    const category = await llm.categorize(payload.title, payload.url, payload.categories);
                    ws.send(JSON.stringify({
                        type: 'llm-categorize-response',
                        payload: { ok: true, category, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-categorize-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-parse-command':
            getLocalLLM().then(async llm => {
                try {
                    const parsed = await llm.parseCommand(payload.command, payload.context || {});
                    ws.send(JSON.stringify({
                        type: 'llm-command-response',
                        payload: { ok: true, parsed, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-command-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        // Co-working Agent WebSocket handlers
        case 'llm-batch-categorize':
            getLocalLLM().then(async llm => {
                try {
                    const results = await llm.batchCategorize(payload.items, payload.categories);
                    ws.send(JSON.stringify({
                        type: 'llm-batch-categorize-response',
                        payload: { ok: true, results, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-batch-categorize-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-smart-search':
            getLocalLLM().then(async llm => {
                try {
                    const results = await llm.smartSearch(payload.query, payload.items, payload.limit || 10);
                    ws.send(JSON.stringify({
                        type: 'llm-smart-search-response',
                        payload: { ok: true, results, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-smart-search-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-suggest-workspaces':
            getLocalLLM().then(async llm => {
                try {
                    const suggestions = await llm.suggestWorkspaces(payload.urls);
                    ws.send(JSON.stringify({
                        type: 'llm-suggest-workspaces-response',
                        payload: { ok: true, suggestions, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-suggest-workspaces-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-generate-briefing':
            getLocalLLM().then(async llm => {
                try {
                    const briefing = await llm.generateBriefing(payload.context || {});
                    ws.send(JSON.stringify({
                        type: 'llm-generate-briefing-response',
                        payload: { ok: true, briefing, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-generate-briefing-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
            break;

        case 'llm-agent-request':
            getLocalLLM().then(async llm => {
                try {
                    const result = await llm.handleAgentRequest(payload.userInput, payload.context || {});
                    ws.send(JSON.stringify({
                        type: 'llm-agent-request-response',
                        payload: { ok: true, result, requestId: payload.requestId }
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'llm-agent-request-response',
                        payload: { ok: false, error: err.message, requestId: payload.requestId }
                    }));
                }
            });
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

/**
 * Merge workspaces by NAME (case-insensitive) instead of ID
 * This handles multi-browser sync where Chrome and Edge create workspaces with different IDs
 * but the same name (e.g., "Social", "Shopping")
 */
function mergeWorkspacesByName(local, remote) {
    const merged = new Map(); // key: lowercase name

    // Helper to normalize URL for deduplication
    const normalizeUrl = (url) => {
        if (!url) return null;
        try {
            const u = new URL(url.startsWith('http') ? url : `https://${url}`);
            // Normalize: lowercase hostname, remove www, remove trailing slash
            return `${u.protocol}//${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
        } catch {
            return url.toLowerCase();
        }
    };

    // Helper to deduplicate URLs within a workspace
    const dedupeUrls = (urls) => {
        if (!Array.isArray(urls)) return [];
        const seen = new Map(); // normalizedUrl -> urlObject
        for (const urlObj of urls) {
            const normalized = normalizeUrl(urlObj?.url);
            if (!normalized) continue;
            const existing = seen.get(normalized);
            // Keep the one with more data or newer timestamp
            if (!existing) {
                seen.set(normalized, urlObj);
            } else {
                const existingTime = existing.addedAt || existing.createdAt || 0;
                const newTime = urlObj.addedAt || urlObj.createdAt || 0;
                // Prefer the one with title, or newer
                if ((!existing.title && urlObj.title) || newTime > existingTime) {
                    seen.set(normalized, urlObj);
                }
            }
        }
        return Array.from(seen.values());
    };

    // Add all local workspaces
    for (const ws of local) {
        if (!ws?.name) continue;
        const key = ws.name.toLowerCase().trim();
        merged.set(key, { ...ws, urls: dedupeUrls(ws.urls) });
    }

    // Merge remote workspaces
    for (const ws of remote) {
        if (!ws?.name) continue;
        const key = ws.name.toLowerCase().trim();
        const existing = merged.get(key);

        if (!existing) {
            // New workspace
            merged.set(key, { ...ws, urls: dedupeUrls(ws.urls) });
        } else {
            // Merge: combine URLs, keep newer metadata
            const remoteTime = ws.updatedAt || ws.createdAt || 0;
            const localTime = existing.updatedAt || existing.createdAt || 0;

            // Combine URLs from both, then dedupe
            const combinedUrls = [...(existing.urls || []), ...(ws.urls || [])];
            const dedupedUrls = dedupeUrls(combinedUrls);

            // Use metadata from the newer one, but keep the older ID for consistency
            const mergedWs = remoteTime > localTime
                ? { ...ws, id: existing.id, urls: dedupedUrls }
                : { ...existing, urls: dedupedUrls, updatedAt: Math.max(remoteTime, localTime) };

            merged.set(key, mergedWs);
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
        // Close spotlight window if it exists
        if (spotlightWindow && !spotlightWindow.isDestroyed()) {
            spotlightWindow.destroy();
            spotlightWindow = null;
        }
        // Quit the app when main window is closed (except on macOS)
        if (process.platform !== 'darwin') {
            app.quit();
        }
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

    // Load the lightweight spotlight app
    if (process.env.NODE_ENV === 'development') {
        // In development, Vite serves spotlight.html at /spotlight.html
        spotlightWindow.loadURL('http://localhost:5173/spotlight.html');
    } else {
        // In production, load the built spotlight.html
        spotlightWindow.loadFile(join(__dirname, 'dist-electron', 'spotlight.html'));
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

// Dev helper: Reload spotlight window (Ctrl+Shift+R when spotlight is focused)
function reloadSpotlight() {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
        console.log('[Electron] Reloading spotlight window...');
        spotlightWindow.webContents.reload();
    }
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
    // Use name-based merge for workspaces to handle multi-browser sync
    const incoming = Array.isArray(data) ? data : [];
    syncData.workspaces = mergeWorkspacesByName(syncData.workspaces, incoming);
    // Limit workspaces if needed, but they are usually few
    syncData.lastUpdated.workspaces = Date.now();
    saveData();
    broadcastToClients('workspaces-updated', syncData.workspaces);
    return { ok: true };
});

ipcMain.handle('sync:get-scraped-chats', () => syncData.scrapedChats);
ipcMain.handle('sync:set-scraped-chats', (_event, data) => {
    const incoming = Array.isArray(data) ? data : [];
    // Merge new chats
    syncData.scrapedChats = mergeArrayById(syncData.scrapedChats, incoming, 'scrapedChats');
    // CAP: Keep only last 50 chats to save memory
    if (syncData.scrapedChats.length > 50) {
        // Sort by recency (assuming createdAt or similar) and keep latest
        syncData.scrapedChats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        syncData.scrapedChats = syncData.scrapedChats.slice(0, 50);
    }
    syncData.lastUpdated.scrapedChats = Date.now();
    saveData();
    broadcastToClients('scraped-chats-updated', syncData.scrapedChats);
    return { ok: true };
});

ipcMain.handle('sync:get-scraped-configs', () => syncData.scrapedConfigs);
ipcMain.handle('sync:set-scraped-configs', (_event, data) => {
    const incoming = Array.isArray(data) ? data : [];
    syncData.scrapedConfigs = mergeArrayById(syncData.scrapedConfigs, incoming, 'scrapedConfigs');
    // CAP: Keep only last 50 configs
    if (syncData.scrapedConfigs.length > 50) {
        syncData.scrapedConfigs = syncData.scrapedConfigs.slice(-50);
    }
    syncData.lastUpdated.scrapedConfigs = Date.now();
    saveData();
    broadcastToClients('scraped-configs-updated', syncData.scrapedConfigs);
    return { ok: true };
});

ipcMain.handle('sync:get-daily-memory', () => syncData.dailyMemory);
ipcMain.handle('sync:set-daily-memory', (_event, data) => {
    const incoming = Array.isArray(data) ? data : [];
    syncData.dailyMemory = mergeArrayById(syncData.dailyMemory, incoming);
    // CAP: Keep last 100 entries
    if (syncData.dailyMemory.length > 100) {
        syncData.dailyMemory = syncData.dailyMemory.slice(-100);
    }
    syncData.lastUpdated.dailyMemory = Date.now();
    saveData();
    broadcastToClients('daily-memory-updated', syncData.dailyMemory);
    return { ok: true };
});

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

            // Always broadcast to extensions first - they can handle window focus too
            broadcastToClients('jump-to-tab', {
                tabId: message.tabId,
                windowId: message.windowId
            });

            // On Windows, also try to force focus from Electron side as backup
            if (process.platform === 'win32') {
                focusBrowserWindow().catch(err => {
                    console.warn('[Electron] focusBrowserWindow failed:', err);
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

// Force refresh installed apps cache (useful after installing new apps)
ipcMain.handle('refresh-installed-apps', async () => {
    try {
        console.log('[Electron] Force refreshing installed apps cache...');
        installedAppsCache = null;
        installedAppsCacheTime = 0;
        const apps = await getInstalledApps();
        return { success: true, count: apps.length };
    } catch (e) {
        console.warn('[Electron] refresh-installed-apps failed:', e.message);
        return { success: false, error: e.message };
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

ipcMain.handle('sync:get-tabs', () => {
    // Return tabs immediately - the tabs-updated event will notify when new tabs arrive
    console.log('[Electron IPC] get-tabs: Returning', syncData.tabs?.length || 0, 'tabs');
    return syncData.tabs;
});
ipcMain.handle('sync:set-tabs', (_event, data) => {
    // data should be { deviceId: '...', tabs: [...] } or just [...] (legacy)
    let ipcTabs = [];
    let ipcDeviceId = 'ipc-unknown';

    if (Array.isArray(data)) {
        ipcTabs = data;
        console.log('[Electron IPC] Received legacy tab array. Count:', ipcTabs.length);
    } else if (data && Array.isArray(data.tabs)) {
        ipcTabs = data.tabs;
        ipcDeviceId = data.deviceId || 'ipc-unknown';
        console.log('[Electron IPC] Received tabs from device:', ipcDeviceId, 'Count:', ipcTabs.length);
    }

    // Store tabs for this device
    syncData.deviceTabsMap.set(ipcDeviceId, ipcTabs);

    // Recompute aggregated tabs
    recomputeAggregatedTabs();

    // We don't save tabs to disk to avoid stale sessions on restart
    // saveData();

    // Notify renderer and other clients
    notifyRenderer('tabs-updated', syncData.tabs);
    broadcastToClients('tabs-updated', syncData.tabs);
    return { ok: true };
});

// ==========================================
// LOCAL LLM IPC HANDLERS
// ==========================================

/**
 * Lazy load the local LLM module
 */
async function getLocalLLM() {
    if (!localLLM) {
        try {
            localLLM = await import('./src/ai/localLLM.js');
            await localLLM.initializeLLM();
            console.log('[Electron] LocalLLM module loaded');
        } catch (error) {
            console.error('[Electron] Failed to load LocalLLM:', error);
            throw error;
        }
    }
    return localLLM;
}

// Get LLM status
ipcMain.handle('llm:get-status', async () => {
    // Check if loaded without triggering load
    if (!localLLM) {
        return {
            initialized: false,
            modelLoaded: false,
            isLoading: false
        };
    }
    try {
        return localLLM.getStatus();
    } catch (error) {
        return {
            initialized: false,
            modelLoaded: false,
            error: error.message
        };
    }
});

// Get available models
ipcMain.handle('llm:get-models', async () => {
    // Check if loaded without triggering load
    if (!localLLM) {
        // Return empty or default state if not loaded
        // We could load just the config here if needed, but for now safe to return empty
        // Or trigger load? No, let's keep it lazy.
        return {};
    }
    try {
        return localLLM.getAvailableModels();
    } catch (error) {
        return { error: error.message };
    }
});

// Download a model
ipcMain.handle('llm:download-model', async (_event, modelName) => {
    try {
        const llm = await getLocalLLM();
        const modelPath = await llm.downloadModel(modelName, (progress) => {
            // Send progress to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-progress', {
                    type: 'download',
                    progress,
                    modelName
                });
            }
            broadcastToClients('llm-progress', { type: 'download', progress, modelName });
        });
        return { ok: true, path: modelPath };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Load a model
ipcMain.handle('llm:load-model', async (_event, modelName) => {
    try {
        const llm = await getLocalLLM();

        // Set up progress listener
        const removeListener = llm.onProgress((type, progress, name, error) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-progress', { type, progress, modelName: name, error });
            }
            broadcastToClients('llm-progress', { type, progress, modelName: name, error });
        });

        const result = await llm.loadModel(modelName);
        removeListener();

        return { ok: result };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Unload model
ipcMain.handle('llm:unload-model', async () => {
    try {
        const llm = await getLocalLLM();
        await llm.unloadModel();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Chat (non-streaming)
ipcMain.handle('llm:chat', async (_event, prompt, options = {}) => {
    try {
        const llm = await getLocalLLM();
        const response = await llm.chat(prompt, options);
        return { ok: true, response };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Chat streaming - sends tokens via IPC events
ipcMain.handle('llm:chat-stream', async (_event, prompt, options = {}) => {
    try {
        const llm = await getLocalLLM();
        const requestId = Date.now().toString();

        // Start streaming in background
        llm.chatStream(prompt, (token) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-token', { requestId, token });
            }
            broadcastToClients('llm-token', { requestId, token });
        }, options).then((fullResponse) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-complete', { requestId, response: fullResponse });
            }
            broadcastToClients('llm-complete', { requestId, response: fullResponse });
        }).catch((error) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-error', { requestId, error: error.message });
            }
            broadcastToClients('llm-error', { requestId, error: error.message });
        });

        return { ok: true, requestId };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Summarize text
ipcMain.handle('llm:summarize', async (_event, text, maxLength = 3) => {
    try {
        const llm = await getLocalLLM();
        const summary = await llm.summarize(text, maxLength);
        return { ok: true, summary };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Categorize URL
ipcMain.handle('llm:categorize', async (_event, title, url, categories) => {
    try {
        const llm = await getLocalLLM();
        const category = await llm.categorize(title, url, categories);
        return { ok: true, category };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Answer question about content
ipcMain.handle('llm:answer', async (_event, question, content) => {
    try {
        const llm = await getLocalLLM();
        const answer = await llm.answerQuestion(question, content);
        return { ok: true, answer };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Parse natural language command
ipcMain.handle('llm:parse-command', async (_event, command, context = {}) => {
    try {
        const llm = await getLocalLLM();
        const parsed = await llm.parseCommand(command, context);
        return { ok: true, parsed };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Get embeddings
ipcMain.handle('llm:get-embedding', async (_event, text) => {
    try {
        const llm = await getLocalLLM();
        const embedding = await llm.getEmbedding(text);
        return { ok: true, embedding };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// ==========================================
// CO-WORKING AGENT IPC HANDLERS
// ==========================================

// Batch categorize URLs
ipcMain.handle('llm:batch-categorize', async (_event, items, categories) => {
    try {
        const llm = await getLocalLLM();
        const results = await llm.batchCategorize(items, categories);
        return { ok: true, results };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Smart search
ipcMain.handle('llm:smart-search', async (_event, query, items, limit = 10) => {
    try {
        const llm = await getLocalLLM();
        const results = await llm.smartSearch(query, items, limit);
        return { ok: true, results };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Suggest workspaces
ipcMain.handle('llm:suggest-workspaces', async (_event, urls) => {
    try {
        const llm = await getLocalLLM();
        const suggestions = await llm.suggestWorkspaces(urls);
        return { ok: true, suggestions };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Generate briefing
ipcMain.handle('llm:generate-briefing', async (_event, context) => {
    try {
        const llm = await getLocalLLM();
        const briefing = await llm.generateBriefing(context);
        return { ok: true, briefing };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});

// Agent request handler
ipcMain.handle('llm:agent-request', async (_event, userInput, context) => {
    try {
        const llm = await getLocalLLM();
        const result = await llm.handleAgentRequest(userInput, context);
        return { ok: true, result };
    } catch (error) {
        return { ok: false, error: error.message };
    }
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
const SPOTLIGHT_RELOAD_SHORTCUT = 'Alt+Shift+R'; // Dev: reload spotlight

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

    // Dev mode: register reload shortcut for spotlight
    if (process.env.NODE_ENV === 'development') {
        if (globalShortcut.isRegistered(SPOTLIGHT_RELOAD_SHORTCUT)) {
            globalShortcut.unregister(SPOTLIGHT_RELOAD_SHORTCUT);
        }
        globalShortcut.register(SPOTLIGHT_RELOAD_SHORTCUT, () => {
            console.log('[Electron] Dev reload shortcut triggered');
            reloadSpotlight();
        });
        console.log(`[Electron] Dev reload shortcut registered: ${SPOTLIGHT_RELOAD_SHORTCUT}`);
    }

    console.log(`[Electron] Global shortcut registered: ${SPOTLIGHT_SHORTCUT}`);
    return true;
}

app.whenReady().then(() => {
    // Disable default menu to save resources (we don't use it)
    Menu.setApplicationMenu(null);

    // Load persisted data
    loadData();

    // Start desktop activity tracking
    startAppActivityTracking();

    // Pre-warm installed apps cache in background (don't block startup)
    setTimeout(() => {
        console.log('[Electron] Pre-warming installed apps cache...');
        getInstalledApps().catch(e => console.warn('[Electron] Pre-warm failed:', e));
    }, 3000); // Delay 3s after app is ready

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

    // Close spotlight window
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
        spotlightWindow.destroy();
        spotlightWindow = null;
    }

    // Close WebSocket server
    if (wss) {
        wss.close();
    }

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
