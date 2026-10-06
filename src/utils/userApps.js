/**
 * Running-app entries a person would recognise as "their" apps: no browsers
 * (tabs are shown separately), no CoolDesk itself, no OS/system processes.
 * Shared by the Tabs page's Active Apps section and the dock's Active view so
 * the two never disagree about what's running.
 */

const SYSTEM_EXACT_NAMES = new Set([
  // Windows system processes
  'svchost', 'csrss', 'smss', 'wininit', 'winlogon', 'services', 'lsass',
  'registry', 'system', 'idle', 'dwm', 'conhost', 'ctfmon', 'spoolsv',
  'taskhostw', 'sihost', 'runtimebroker', 'applicationframehost',
  'searchindexer', 'searchhost', 'securityhealthsystray',
  // macOS system UI processes
  'windowserver', 'dock', 'controlcenter', 'notificationcenter',
  'spotlight', 'loginwindow', 'textinputswitcher', 'accessibilityuiserver',
  'cursoruiviewservice', 'nsattributedstringagent', 'webthumbnailextension',
  'linkednotesuitservice', 'securityprivacyextension',
]);

const isMacSystemProcess = (name) =>
  name.startsWith('com.apple.') ||
  name.includes('.xpc.') ||
  (name.endsWith('helper') && !name.includes(' ')) ||
  (name.endsWith('agent') && !name.includes(' '));

export function isBrowserApp(appName) {
  return appName.includes('chrome') ||
    appName === 'msedge' ||
    appName === 'microsoft edge' ||
    appName === 'edge' ||
    appName.includes('brave') ||
    appName.includes('firefox') ||
    appName.includes('opera') ||
    appName.includes('vivaldi') ||
    appName.includes('arc');
}

export function filterUserApps(apps) {
  return apps.filter(app => {
    const appName = (app.name || '').toLowerCase();

    if (isBrowserApp(appName)) return false;

    // Skip cooldesk app itself
    const isCoolDesk = appName.includes('cooldesk') ||
      appName.includes('cool-desk') ||
      appName.includes('tauri') ||
      appName.includes('webview') ||
      appName.includes('wry');
    if (isCoolDesk) return false;

    if (SYSTEM_EXACT_NAMES.has(appName)) return false;
    if (isMacSystemProcess(appName)) return false;

    // Skip tray/background windows on Windows only.
    // macOS apps (source: applications/system_applications/user_applications) are
    // pre-filtered by the scanner — all entries here are valid user apps regardless
    // of isVisible (macOS apps frequently report isVisible=false even when open).
    const isMacStyle = app.source === 'applications' ||
      app.source === 'system_applications' ||
      app.source === 'user_applications' ||
      app.source === 'macos';
    if (!isMacStyle) {
      const isTrayOnly = app.isVisible === false && (app.cloaked || 0) !== 2;
      if (isTrayOnly) return false;
    }

    return true;
  });
}
