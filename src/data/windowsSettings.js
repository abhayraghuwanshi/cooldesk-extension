// Windows Settings pages, searchable from Spotlight.
//
// Each Windows "Settings" page is reachable via the `ms-settings:` URI scheme,
// which the shell launches through ShellExecute (the same path `open_url` uses in
// the Tauri backend). So selecting one of these just calls openExternal(uri) —
// no native code required. This is Windows-only; the matcher is gated on platform
// in GlobalSpotlight.
//
// `keywords` exist so a search can match by synonym/intent ("wallpaper" →
// Background, "antivirus" → Windows Security) rather than only the visible title.
//
// Reference: https://learn.microsoft.com/windows/uwp/launch-resume/launch-settings-app

import { fuzzyScore } from '../services/searchService';

export const WINDOWS_SETTINGS = [
    // ── System ────────────────────────────────────────────────────────────────
    { title: 'Display', uri: 'ms-settings:display', category: 'System', keywords: ['screen', 'resolution', 'monitor', 'scale', 'brightness', 'orientation'] },
    { title: 'Night Light', uri: 'ms-settings:nightlight', category: 'System', keywords: ['blue light', 'warm', 'color temperature', 'eye strain'] },
    { title: 'Sound', uri: 'ms-settings:sound', category: 'System', keywords: ['audio', 'volume', 'speakers', 'microphone', 'output', 'input'] },
    { title: 'Notifications', uri: 'ms-settings:notifications', category: 'System', keywords: ['alerts', 'banners', 'toast', 'do not disturb'] },
    { title: 'Focus Assist', uri: 'ms-settings:quiethours', category: 'System', keywords: ['focus', 'do not disturb', 'quiet hours', 'concentration'] },
    { title: 'Power & Battery', uri: 'ms-settings:powersleep', category: 'System', keywords: ['power', 'sleep', 'battery', 'energy', 'screen timeout', 'hibernate'] },
    { title: 'Battery Saver', uri: 'ms-settings:batterysaver', category: 'System', keywords: ['battery', 'save power', 'low power'] },
    { title: 'Storage', uri: 'ms-settings:storagesense', category: 'System', keywords: ['disk', 'space', 'storage sense', 'cleanup', 'free up space'] },
    { title: 'Multitasking', uri: 'ms-settings:multitasking', category: 'System', keywords: ['snap', 'windows', 'task switching', 'alt tab', 'virtual desktops'] },
    { title: 'Clipboard', uri: 'ms-settings:clipboard', category: 'System', keywords: ['clipboard history', 'copy', 'paste', 'sync'] },
    { title: 'Remote Desktop', uri: 'ms-settings:remotedesktop', category: 'System', keywords: ['rdp', 'remote', 'connect'] },
    { title: 'Projecting to this PC', uri: 'ms-settings:project', category: 'System', keywords: ['project', 'second screen', 'cast', 'wireless display', 'miracast'] },
    { title: 'About', uri: 'ms-settings:about', category: 'System', keywords: ['device specs', 'pc name', 'rename pc', 'windows version', 'system info', 'ram', 'processor'] },

    // ── Bluetooth & devices ───────────────────────────────────────────────────
    { title: 'Bluetooth & Devices', uri: 'ms-settings:bluetooth', category: 'Devices', keywords: ['bluetooth', 'pair', 'wireless', 'headphones', 'add device'] },
    { title: 'Printers & Scanners', uri: 'ms-settings:printers', category: 'Devices', keywords: ['printer', 'scanner', 'print', 'add printer'] },
    { title: 'Mouse', uri: 'ms-settings:mousetouchpad', category: 'Devices', keywords: ['mouse', 'pointer', 'cursor', 'scroll', 'buttons'] },
    { title: 'Touchpad', uri: 'ms-settings:devices-touchpad', category: 'Devices', keywords: ['touchpad', 'trackpad', 'gestures', 'taps'] },
    { title: 'Pen & Windows Ink', uri: 'ms-settings:pen', category: 'Devices', keywords: ['pen', 'stylus', 'ink', 'handwriting'] },
    { title: 'AutoPlay', uri: 'ms-settings:autoplay', category: 'Devices', keywords: ['autoplay', 'removable drive', 'usb', 'memory card'] },
    { title: 'USB', uri: 'ms-settings:usb', category: 'Devices', keywords: ['usb', 'connection notifications'] },

    // ── Network & internet ────────────────────────────────────────────────────
    { title: 'Network & Internet', uri: 'ms-settings:network-status', category: 'Network', keywords: ['network', 'internet', 'status', 'connection', 'data usage'] },
    { title: 'Wi-Fi', uri: 'ms-settings:network-wifi', category: 'Network', keywords: ['wifi', 'wireless', 'network', 'connect', 'known networks'] },
    { title: 'Ethernet', uri: 'ms-settings:network-ethernet', category: 'Network', keywords: ['ethernet', 'wired', 'lan'] },
    { title: 'VPN', uri: 'ms-settings:network-vpn', category: 'Network', keywords: ['vpn', 'virtual private network'] },
    { title: 'Mobile Hotspot', uri: 'ms-settings:network-mobilehotspot', category: 'Network', keywords: ['hotspot', 'tethering', 'share internet'] },
    { title: 'Airplane Mode', uri: 'ms-settings:network-airplanemode', category: 'Network', keywords: ['airplane', 'flight mode', 'radios'] },
    { title: 'Proxy', uri: 'ms-settings:network-proxy', category: 'Network', keywords: ['proxy', 'pac', 'manual proxy'] },

    // ── Personalization ───────────────────────────────────────────────────────
    { title: 'Personalization', uri: 'ms-settings:personalization', category: 'Personalization', keywords: ['personalize', 'customize', 'appearance'] },
    { title: 'Background', uri: 'ms-settings:personalization-background', category: 'Personalization', keywords: ['wallpaper', 'desktop background', 'slideshow', 'picture'] },
    { title: 'Colors', uri: 'ms-settings:colors', category: 'Personalization', keywords: ['accent color', 'dark mode', 'light mode', 'theme color', 'transparency'] },
    { title: 'Themes', uri: 'ms-settings:themes', category: 'Personalization', keywords: ['theme', 'desktop icons', 'cursor', 'sounds'] },
    { title: 'Lock Screen', uri: 'ms-settings:lockscreen', category: 'Personalization', keywords: ['lock screen', 'spotlight', 'screen saver'] },
    { title: 'Start', uri: 'ms-settings:personalization-start', category: 'Personalization', keywords: ['start menu', 'pinned', 'recommended'] },
    { title: 'Taskbar', uri: 'ms-settings:taskbar', category: 'Personalization', keywords: ['taskbar', 'system tray', 'corner', 'search box', 'widgets'] },
    { title: 'Fonts', uri: 'ms-settings:fonts', category: 'Personalization', keywords: ['fonts', 'typeface', 'install font'] },

    // ── Apps ──────────────────────────────────────────────────────────────────
    { title: 'Installed Apps', uri: 'ms-settings:appsfeatures', category: 'Apps', keywords: ['apps', 'programs', 'uninstall', 'remove app', 'features'] },
    { title: 'Default Apps', uri: 'ms-settings:defaultapps', category: 'Apps', keywords: ['default browser', 'default apps', 'file associations', 'open with'] },
    { title: 'Startup Apps', uri: 'ms-settings:startupapps', category: 'Apps', keywords: ['startup', 'launch at login', 'boot apps', 'autostart'] },
    { title: 'Optional Features', uri: 'ms-settings:optionalfeatures', category: 'Apps', keywords: ['optional features', 'windows features', 'add feature'] },

    // ── Accounts ──────────────────────────────────────────────────────────────
    { title: 'Your Info', uri: 'ms-settings:yourinfo', category: 'Accounts', keywords: ['account', 'profile', 'microsoft account', 'avatar', 'profile picture'] },
    { title: 'Email & Accounts', uri: 'ms-settings:emailandaccounts', category: 'Accounts', keywords: ['email', 'accounts', 'add account'] },
    { title: 'Sign-in Options', uri: 'ms-settings:signinoptions', category: 'Accounts', keywords: ['pin', 'password', 'windows hello', 'fingerprint', 'face unlock', 'security key', 'login'] },
    { title: 'Family', uri: 'ms-settings:family', category: 'Accounts', keywords: ['family', 'parental controls', 'child account', 'screen time'] },
    { title: 'Access Work or School', uri: 'ms-settings:workplace', category: 'Accounts', keywords: ['work', 'school', 'azure ad', 'enroll', 'domain'] },
    { title: 'Windows Backup', uri: 'ms-settings:backup', category: 'Accounts', keywords: ['backup', 'sync settings', 'onedrive', 'restore'] },

    // ── Time & language ───────────────────────────────────────────────────────
    { title: 'Date & Time', uri: 'ms-settings:dateandtime', category: 'Time & Language', keywords: ['date', 'time', 'clock', 'timezone', 'time zone'] },
    { title: 'Language & Region', uri: 'ms-settings:regionlanguage', category: 'Time & Language', keywords: ['language', 'region', 'locale', 'keyboard layout', 'country'] },
    { title: 'Typing', uri: 'ms-settings:typing', category: 'Time & Language', keywords: ['typing', 'autocorrect', 'suggestions', 'spell check', 'keyboard'] },
    { title: 'Speech', uri: 'ms-settings:speech', category: 'Time & Language', keywords: ['speech', 'voice', 'dictation', 'text to speech'] },

    // ── Gaming ────────────────────────────────────────────────────────────────
    { title: 'Game Bar', uri: 'ms-settings:gaming-gamebar', category: 'Gaming', keywords: ['game bar', 'xbox', 'overlay', 'capture'] },
    { title: 'Game Mode', uri: 'ms-settings:gaming-gamemode', category: 'Gaming', keywords: ['game mode', 'performance', 'fps'] },
    { title: 'Captures', uri: 'ms-settings:gaming-gamedvr', category: 'Gaming', keywords: ['captures', 'recording', 'screenshots', 'clips', 'dvr'] },

    // ── Accessibility ─────────────────────────────────────────────────────────
    { title: 'Accessibility', uri: 'ms-settings:easeofaccess', category: 'Accessibility', keywords: ['accessibility', 'ease of access', 'disability'] },
    { title: 'Text Size', uri: 'ms-settings:easeofaccess-display', category: 'Accessibility', keywords: ['text size', 'larger text', 'font size'] },
    { title: 'Magnifier', uri: 'ms-settings:easeofaccess-magnifier', category: 'Accessibility', keywords: ['magnifier', 'zoom', 'enlarge'] },
    { title: 'Color Filters', uri: 'ms-settings:easeofaccess-colorfilter', category: 'Accessibility', keywords: ['color filters', 'colorblind', 'grayscale'] },
    { title: 'Contrast Themes', uri: 'ms-settings:easeofaccess-highcontrast', category: 'Accessibility', keywords: ['high contrast', 'contrast themes'] },
    { title: 'Narrator', uri: 'ms-settings:easeofaccess-narrator', category: 'Accessibility', keywords: ['narrator', 'screen reader', 'read aloud'] },
    { title: 'Mouse Pointer', uri: 'ms-settings:easeofaccess-mousepointer', category: 'Accessibility', keywords: ['pointer size', 'cursor size', 'pointer color'] },

    // ── Privacy & security ────────────────────────────────────────────────────
    { title: 'Privacy & Security', uri: 'ms-settings:privacy', category: 'Privacy', keywords: ['privacy', 'permissions', 'security'] },
    { title: 'Windows Security', uri: 'ms-settings:windowsdefender', category: 'Privacy', keywords: ['windows security', 'defender', 'antivirus', 'firewall', 'virus protection'] },
    { title: 'Camera Privacy', uri: 'ms-settings:privacy-webcam', category: 'Privacy', keywords: ['camera', 'webcam', 'camera access'] },
    { title: 'Microphone Privacy', uri: 'ms-settings:privacy-microphone', category: 'Privacy', keywords: ['microphone', 'mic access'] },
    { title: 'Location', uri: 'ms-settings:privacy-location', category: 'Privacy', keywords: ['location', 'gps', 'location access'] },
    { title: 'Activity History', uri: 'ms-settings:privacy-activityhistory', category: 'Privacy', keywords: ['activity history', 'timeline'] },

    // ── Windows Update & recovery ─────────────────────────────────────────────
    { title: 'Windows Update', uri: 'ms-settings:windowsupdate', category: 'Update', keywords: ['windows update', 'update', 'check for updates', 'upgrade'] },
    { title: 'Update History', uri: 'ms-settings:windowsupdate-history', category: 'Update', keywords: ['update history', 'installed updates', 'uninstall update'] },
    { title: 'Delivery Optimization', uri: 'ms-settings:delivery-optimization', category: 'Update', keywords: ['delivery optimization', 'download updates', 'bandwidth'] },
    { title: 'Recovery', uri: 'ms-settings:recovery', category: 'Update', keywords: ['recovery', 'reset this pc', 'reset', 'reinstall windows', 'advanced startup'] },
    { title: 'Activation', uri: 'ms-settings:activation', category: 'Update', keywords: ['activation', 'license', 'product key', 'activate windows'] },
    { title: 'For Developers', uri: 'ms-settings:developers', category: 'Update', keywords: ['developer mode', 'developers', 'device portal'] },
    { title: 'Troubleshoot', uri: 'ms-settings:troubleshoot', category: 'Update', keywords: ['troubleshoot', 'fix problems', 'troubleshooter'] },
];

// Score one entry. The title is the strongest signal; keyword and category
// matches are accepted but slightly discounted so a title hit wins ties. Reusing
// the shared fuzzyScore keeps matching consistent with the rest of Spotlight
// (acronyms like "wu" → Windows Update, subsequences like "blth" → Bluetooth,
// multi-word like "default browser" → Default Apps).
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

// Search the Windows Settings catalog. Returns Spotlight result items
// ({ type: 'setting', uri, score, ... }). Windows-only; the caller gates on
// platform. Requires a 2+ char query, and drops weak fuzzy noise via a threshold
// so unrelated queries don't surface random settings.
export function searchWindowsSettings(query, limit = 5) {
    const q = (query || '').trim();
    if (q.length < 2) return [];

    const MIN_SCORE = 55; // below this, fuzzyScore is just loose character soup
    const scored = [];
    for (const entry of WINDOWS_SETTINGS) {
        const score = scoreEntry(entry, q);
        if (score >= MIN_SCORE) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ entry, score }) => ({
        id: `setting:${entry.uri}`,
        type: 'setting',
        title: entry.title,
        description: `${entry.category} • Windows Settings`,
        uri: entry.uri,
        score,
    }));
}
