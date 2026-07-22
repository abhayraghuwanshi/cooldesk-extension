// Platform-aware keyboard-shortcut labels.
//
// Two different things get called "Ctrl" in this app, and they render
// differently on macOS — mixing them up prints a shortcut that doesn't work:
//
//   1. In-app shortcuts. The handlers all test `e.ctrlKey || e.metaKey`
//      (WorkspaceShell.jsx:131, GlobalAddButton.jsx:77, CoolDeskContainer's
//      Ctrl+Shift+D/G/K), so on a Mac the working key is Command → show ⌘.
//
//   2. Global-shortcut accelerator strings passed to Tauri
//      (`set_spotlight_shortcut`). There "Ctrl" is literally Control and
//      "Meta"/"Super" is Command → show ⌃ and ⌘ respectively.
//
// Use `appKey()` for the first and `accelKey()` for the second.

export const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(
    navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ''
  );

// In-app shortcuts: Ctrl stands in for "Ctrl or Cmd", so it becomes ⌘ on macOS.
const APP_KEYS_MAC = {
  Ctrl: '⌘',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
  Enter: '↵',
  Escape: 'esc',
};

// Accelerator strings: every modifier means exactly itself.
const ACCEL_KEYS_MAC = {
  Ctrl: '⌃',
  Control: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Meta: '⌘',
  Super: '⌘',
  Command: '⌘',
  Cmd: '⌘',
};

// Windows/Linux: only Meta needs a friendlier name than its accelerator token.
const KEYS_OTHER = {
  Meta: 'Win',
  Super: 'Win',
  Command: 'Win',
  Cmd: 'Win',
};

/** Label for an in-app shortcut key (Ctrl → ⌘ on macOS). */
export const appKey = (token) =>
  (IS_MAC ? APP_KEYS_MAC[token] : KEYS_OTHER[token]) || token;

/** Label for one token of a global-shortcut accelerator (Alt → ⌥ on macOS). */
export const accelKey = (token) =>
  (IS_MAC ? ACCEL_KEYS_MAC[token] : KEYS_OTHER[token]) || token;

/** Split an accelerator like "Alt+Shift+K" into display-ready tokens. */
export const accelTokens = (accelerator) =>
  String(accelerator || '').split('+').filter(Boolean).map(t => ({ raw: t, label: accelKey(t) }));
