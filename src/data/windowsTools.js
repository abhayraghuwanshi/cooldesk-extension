// Windows Control Panel applets + system tools, searchable from Spotlight.
//
// These are the things Windows Start search surfaces that have NO `ms-settings:`
// equivalent — classic Control Panel applets (Device Manager, Programs &
// Features, …) and system utilities (Registry Editor, Task Manager, …).
//
// Launch model:
//   • Most entries are a single token — a `.msc` console, a `.cpl` applet, or a
//     bare exe on PATH (regedit, taskmgr). These open via `launchApp(exec)`,
//     which is ShellExecute("open") — i.e. exactly like typing it into Run.
//   • A few need arguments (e.g. `control /name Microsoft.AdministrativeTools`).
//     Those carry `args` and go through `launchAppWithArgs(exec, args)`.
//
// Windows-only; the matcher is gated on platform in GlobalSpotlight.
//
// Reference: https://learn.microsoft.com/windows/win32/shell/launch (Run commands)

import { fuzzyScore } from '../services/searchService';

export const WINDOWS_TOOLS = [
    // ── Control Panel applets (.cpl / .msc) ───────────────────────────────────
    { title: 'Programs & Features', exec: 'appwiz.cpl', category: 'Control Panel', keywords: ['uninstall', 'remove program', 'add remove programs', 'installed programs'] },
    { title: 'Network Connections', exec: 'ncpa.cpl', category: 'Control Panel', keywords: ['network adapter', 'ethernet', 'wifi adapter', 'ip address', 'tcp ip'] },
    { title: 'Sound', exec: 'mmsys.cpl', category: 'Control Panel', keywords: ['audio devices', 'playback', 'recording', 'speakers', 'microphone'] },
    { title: 'Power Options', exec: 'powercfg.cpl', category: 'Control Panel', keywords: ['power plan', 'high performance', 'battery', 'sleep', 'lid'] },
    { title: 'Mouse Properties', exec: 'main.cpl', category: 'Control Panel', keywords: ['mouse', 'pointer', 'double click speed', 'cursor', 'buttons'] },
    { title: 'System Properties', exec: 'sysdm.cpl', category: 'Control Panel', keywords: ['environment variables', 'advanced system settings', 'computer name', 'performance options', 'remote', 'virtual memory'] },
    { title: 'Date and Time', exec: 'timedate.cpl', category: 'Control Panel', keywords: ['clock', 'timezone', 'time zone'] },
    { title: 'Region', exec: 'intl.cpl', category: 'Control Panel', keywords: ['region', 'format', 'locale', 'currency', 'number format'] },
    { title: 'Internet Options', exec: 'inetcpl.cpl', category: 'Control Panel', keywords: ['internet properties', 'proxy', 'security zones', 'trusted sites'] },
    { title: 'Windows Defender Firewall', exec: 'firewall.cpl', category: 'Control Panel', keywords: ['firewall', 'allow app', 'block', 'inbound', 'outbound'] },
    { title: 'User Accounts', exec: 'netplwiz', category: 'Control Panel', keywords: ['user accounts', 'auto login', 'manage users', 'require password'] },
    { title: 'Device Manager', exec: 'devmgmt.msc', category: 'Control Panel', keywords: ['device manager', 'drivers', 'hardware', 'usb devices'] },
    { title: 'Disk Management', exec: 'diskmgmt.msc', category: 'Control Panel', keywords: ['disk management', 'partition', 'format drive', 'volumes', 'drive letter'] },
    { title: 'Computer Management', exec: 'compmgmt.msc', category: 'Control Panel', keywords: ['computer management', 'admin tools'] },
    { title: 'Services', exec: 'services.msc', category: 'Control Panel', keywords: ['services', 'start service', 'stop service', 'startup type'] },
    { title: 'Event Viewer', exec: 'eventvwr.msc', category: 'Control Panel', keywords: ['event viewer', 'logs', 'errors', 'crash', 'event log'] },
    { title: 'Task Scheduler', exec: 'taskschd.msc', category: 'Control Panel', keywords: ['scheduled tasks', 'automation', 'task scheduler', 'cron'] },
    { title: 'Local Group Policy Editor', exec: 'gpedit.msc', category: 'Control Panel', keywords: ['group policy', 'gpedit', 'policies'] },
    { title: 'Local Users and Groups', exec: 'lusrmgr.msc', category: 'Control Panel', keywords: ['local users', 'groups', 'user management'] },
    { title: 'Performance Monitor', exec: 'perfmon.msc', category: 'Control Panel', keywords: ['performance monitor', 'perfmon', 'counters'] },
    { title: 'Certificate Manager', exec: 'certmgr.msc', category: 'Control Panel', keywords: ['certificates', 'certmgr', 'trusted root'] },
    { title: 'Firewall Advanced Security', exec: 'wf.msc', category: 'Control Panel', keywords: ['advanced firewall', 'inbound rules', 'outbound rules', 'firewall rules'] },
    { title: 'Control Panel', exec: 'control', category: 'Control Panel', keywords: ['control panel', 'all control panel items'] },
    { title: 'Administrative Tools', exec: 'control', args: ['/name', 'Microsoft.AdministrativeTools'], category: 'Control Panel', keywords: ['administrative tools', 'windows tools', 'admin tools'] },

    // ── System tools / Run commands ───────────────────────────────────────────
    { title: 'Registry Editor', exec: 'regedit', category: 'System Tool', keywords: ['registry', 'regedit', 'regedit32'] },
    { title: 'Task Manager', exec: 'taskmgr', category: 'System Tool', keywords: ['task manager', 'processes', 'kill', 'end task', 'cpu usage'] },
    { title: 'Command Prompt', exec: 'cmd', category: 'System Tool', keywords: ['command prompt', 'terminal', 'cmd', 'console', 'dos'] },
    { title: 'PowerShell', exec: 'powershell', category: 'System Tool', keywords: ['powershell', 'terminal', 'shell', 'ps'] },
    { title: 'System Configuration', exec: 'msconfig', category: 'System Tool', keywords: ['msconfig', 'startup', 'boot options', 'system configuration', 'safe mode'] },
    { title: 'Disk Cleanup', exec: 'cleanmgr', category: 'System Tool', keywords: ['disk cleanup', 'free space', 'temp files', 'clean disk'] },
    { title: 'Resource Monitor', exec: 'resmon', category: 'System Tool', keywords: ['resource monitor', 'cpu', 'memory', 'disk usage', 'network usage'] },
    { title: 'System Information', exec: 'msinfo32', category: 'System Tool', keywords: ['system information', 'msinfo', 'specs', 'bios', 'hardware info'] },
    { title: 'DirectX Diagnostic Tool', exec: 'dxdiag', category: 'System Tool', keywords: ['dxdiag', 'directx', 'graphics info', 'gpu info'] },
    { title: 'Character Map', exec: 'charmap', category: 'System Tool', keywords: ['character map', 'special characters', 'symbols', 'unicode', 'emoji'] },
    { title: 'On-Screen Keyboard', exec: 'osk', category: 'System Tool', keywords: ['on screen keyboard', 'osk', 'virtual keyboard'] },
    { title: 'Magnifier', exec: 'magnify', category: 'System Tool', keywords: ['magnifier', 'zoom', 'enlarge screen'] },
    { title: 'Steps Recorder', exec: 'psr', category: 'System Tool', keywords: ['steps recorder', 'problem steps recorder', 'record steps'] },
    { title: 'Windows Memory Diagnostic', exec: 'mdsched', category: 'System Tool', keywords: ['memory diagnostic', 'ram test', 'memory test'] },
    { title: 'System Restore', exec: 'rstrui', category: 'System Tool', keywords: ['system restore', 'restore point', 'roll back'] },
    { title: 'Remote Desktop Connection', exec: 'mstsc', category: 'System Tool', keywords: ['remote desktop', 'rdp', 'mstsc', 'connect to pc'] },
    { title: 'Snipping Tool', exec: 'snippingtool', category: 'System Tool', keywords: ['snipping tool', 'screenshot', 'screen clip', 'capture screen'] },
];

// Score one entry — title is the strongest signal, keyword/category matches are
// accepted but slightly discounted. Reuses the shared fuzzyScore so matching is
// consistent with the rest of Spotlight (acronyms, subsequences, multi-word).
function scoreEntry(entry, query) {
    let best = fuzzyScore(entry.title, query);
    for (const kw of entry.keywords) {
        const s = fuzzyScore(kw, query);
        if (s - 6 > best) best = s - 6;
    }
    const c = fuzzyScore(entry.category, query) - 14;
    if (c > best) best = c;
    return best;
}

// Search the Control Panel / system-tools catalog. Returns Spotlight result items
// ({ type: 'tool', exec, args?, score, ... }). Windows-only; the caller gates on
// platform. Requires a 2+ char query and drops weak fuzzy noise via a threshold.
export function searchWindowsTools(query, limit = 5) {
    const q = (query || '').trim();
    if (q.length < 2) return [];

    const MIN_SCORE = 55;
    const scored = [];
    for (const entry of WINDOWS_TOOLS) {
        const score = scoreEntry(entry, q);
        if (score >= MIN_SCORE) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ entry, score }) => ({
        id: `tool:${entry.exec}:${(entry.args || []).join(',')}`,
        type: 'tool',
        title: entry.title,
        description: `${entry.category} • Windows`,
        exec: entry.exec,
        args: entry.args || null,
        score,
    }));
}
