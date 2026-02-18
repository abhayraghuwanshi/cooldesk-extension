/**
 * Windows App Scanner
 * Scans for installed applications from multiple sources
 * Run with: node scripts/scan-apps-windows.js
 */

import { exec } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Scan Program Files directories for .exe files
 */
function scanProgramDirs() {
    const apps = new Map();

    const programDirs = [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.LOCALAPPDATA,
        join(process.env.LOCALAPPDATA || '', 'Programs'),
        join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs'),
        join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Microsoft', 'WindowsApps')
    ].filter(Boolean);

    console.log('Scanning directories:', programDirs);

    for (const dir of programDirs) {
        try {
            if (!existsSync(dir)) continue;

            const entries = readdirSync(dir);
            for (const entry of entries) {
                try {
                    const fullPath = join(dir, entry);
                    const stat = statSync(fullPath);

                    if (stat.isDirectory()) {
                        // Look for main .exe file (skip uninstallers, updaters)
                        const exeFiles = readdirSync(fullPath)
                            .filter(f => f.endsWith('.exe'))
                            .filter(f => !f.toLowerCase().includes('unins'))
                            .filter(f => !f.toLowerCase().includes('update'))
                            .filter(f => !f.toLowerCase().includes('crash'))
                            .filter(f => !f.toLowerCase().includes('helper'));

                        if (exeFiles.length > 0) {
                            // Prefer exe with same name as folder, or first one
                            const mainExe = exeFiles.find(e =>
                                e.toLowerCase().replace('.exe', '') === entry.toLowerCase()
                            ) || exeFiles[0];

                            const appName = entry;
                            if (!apps.has(appName.toLowerCase())) {
                                apps.set(appName.toLowerCase(), {
                                    name: appName,
                                    path: join(fullPath, mainExe),
                                    source: 'program_files'
                                });
                            }
                        }
                    } else if (entry.endsWith('.exe')) {
                        // Direct exe file in directory
                        const appName = entry.replace('.exe', '');
                        if (!apps.has(appName.toLowerCase())) {
                            apps.set(appName.toLowerCase(), {
                                name: appName,
                                path: fullPath,
                                source: 'program_files'
                            });
                        }
                    }
                } catch (e) { /* skip inaccessible */ }
            }
        } catch (e) { /* skip inaccessible dirs */ }
    }

    return apps;
}

/**
 * Scan Start Menu shortcuts using PowerShell
 */
async function scanStartMenu() {
    const apps = new Map();

    const psScript = `
$apps = @()
$paths = @(
    [Environment]::GetFolderPath('CommonStartMenu') + '\\Programs',
    [Environment]::GetFolderPath('StartMenu') + '\\Programs'
)
foreach ($p in $paths) {
    if (Test-Path $p) {
        Get-ChildItem $p -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $s = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName)
                if ($s.TargetPath -and $s.TargetPath -match '\\.exe$' -and (Test-Path $s.TargetPath)) {
                    $apps += @{
                        name = $_.BaseName
                        path = $s.TargetPath
                    }
                }
            } catch {}
        }
    }
}
$apps | ConvertTo-Json
`;

    try {
        const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
        const { stdout, stderr } = await execAsync(
            `powershell -NoProfile -EncodedCommand ${b64}`,
            { windowsHide: true, timeout: 30000 }
        );

        if (stderr) {
            console.warn('PowerShell stderr:', stderr);
        }

        if (stdout && stdout.trim() && stdout.trim() !== 'null') {
            const psApps = JSON.parse(stdout);
            const psArray = Array.isArray(psApps) ? psApps : [psApps];

            for (const a of psArray) {
                if (a && a.name && !apps.has(a.name.toLowerCase())) {
                    apps.set(a.name.toLowerCase(), {
                        name: a.name,
                        path: a.path,
                        source: 'start_menu'
                    });
                }
            }
        }
    } catch (e) {
        console.warn('PowerShell scan failed:', e.message);
    }

    return apps;
}

/**
 * Scan Windows Registry for installed apps
 */
async function scanRegistry() {
    const apps = new Map();

    const regPaths = [
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ];

    for (const regPath of regPaths) {
        try {
            const { stdout } = await execAsync(
                `reg query "${regPath}" /s /v DisplayName 2>nul`,
                { windowsHide: true, timeout: 10000 }
            );

            const lines = stdout.split('\n');
            let currentKey = '';

            for (const line of lines) {
                if (line.startsWith('HKEY_')) {
                    currentKey = line.trim();
                } else if (line.includes('DisplayName') && line.includes('REG_SZ')) {
                    const match = line.match(/DisplayName\s+REG_SZ\s+(.+)/);
                    if (match) {
                        const name = match[1].trim();
                        if (name && !apps.has(name.toLowerCase())) {
                            apps.set(name.toLowerCase(), {
                                name: name,
                                path: null, // Would need another query for InstallLocation
                                source: 'registry',
                                regKey: currentKey
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // Registry path may not exist
        }
    }

    return apps;
}

/**
 * Main: Scan all sources and merge
 */
async function scanAllApps() {
    console.log('=== Windows App Scanner ===\n');

    // Scan all sources
    console.log('1. Scanning Program Files...');
    const programApps = scanProgramDirs();
    console.log(`   Found ${programApps.size} apps\n`);

    console.log('2. Scanning Start Menu...');
    const startMenuApps = await scanStartMenu();
    console.log(`   Found ${startMenuApps.size} apps\n`);

    console.log('3. Scanning Registry...');
    const registryApps = await scanRegistry();
    console.log(`   Found ${registryApps.size} apps\n`);

    // Merge all (prefer ones with paths)
    const allApps = new Map();

    // Add program files apps first (they have paths)
    for (const [key, app] of programApps) {
        allApps.set(key, app);
    }

    // Add start menu apps (they also have paths)
    for (const [key, app] of startMenuApps) {
        if (!allApps.has(key)) {
            allApps.set(key, app);
        }
    }

    // Add registry apps only if not already found
    for (const [key, app] of registryApps) {
        if (!allApps.has(key)) {
            allApps.set(key, app);
        }
    }

    // Sort and format output
    const sortedApps = Array.from(allApps.values())
        .filter(a => a.path) // Only include apps with executable paths
        .sort((a, b) => a.name.localeCompare(b.name));

    console.log('=== Results ===');
    console.log(`Total apps with paths: ${sortedApps.length}\n`);

    // Print apps
    for (const app of sortedApps) {
        console.log(`[${app.source}] ${app.name}`);
        console.log(`   Path: ${app.path}\n`);
    }

    // Return for use as module
    return sortedApps.map(a => ({
        id: `installed-${a.name}`,
        name: a.name,
        title: a.name,
        path: a.path,
        type: 'app',
        isRunning: false
    }));
}

// Run if executed directly
scanAllApps().then(apps => {
    console.log('\n=== JSON Output ===');
    console.log(JSON.stringify(apps.slice(0, 20), null, 2)); // First 20 for preview
    console.log(`\n... and ${Math.max(0, apps.length - 20)} more`);
}).catch(console.error);

export { scanAllApps, scanProgramDirs, scanStartMenu, scanRegistry };
