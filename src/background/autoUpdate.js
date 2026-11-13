// Applies Web Store updates promptly instead of waiting for a browser restart.
//
// Chrome downloads a new version within hours, but it only swaps it in once the
// extension is idle — and a CoolDesk new tab that's left open means it never
// is. So the old version keeps running for days. Here we:
//   - ask the store for updates on startup and every few hours,
//   - remember a pending update so the new tab page can offer "Restart",
//   - reload on our own as soon as no CoolDesk page is open (nothing to lose),
//   - after a reload the user asked for, reopen the new tab they were on.
// The Settings "Auto-Update" switch (autoUpdateEnabled) turns off the silent
// reload; the manual "Restart" button always works.

const PENDING_KEY = 'pendingExtensionUpdate';
const REOPEN_KEY = 'reopenAfterUpdate';
const UPDATED_KEY = 'justUpdated';
const CHECK_ALARM = 'cooldesk-update-check';

async function hasOpenPages() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['TAB', 'POPUP', 'SIDE_PANEL'],
    });
    return contexts.length > 0;
  } catch {
    return true; // can't tell — don't risk closing someone's page
  }
}

async function applyIfIdle() {
  const { [PENDING_KEY]: pending, autoUpdateEnabled } =
    await chrome.storage.local.get([PENDING_KEY, 'autoUpdateEnabled']);
  if (!pending || autoUpdateEnabled === false) return;
  if (await hasOpenPages()) return;
  chrome.runtime.reload();
}

async function checkStore() {
  try {
    // Throttled / no_update both just mean "nothing yet".
    // Firefox updates add-ons itself and has no requestUpdateCheck
    // (compiled out of the Firefox build).
    if (!import.meta.env.VITE_FIREFOX) await chrome.runtime.requestUpdateCheck();
  } catch { /* unpacked dev build */ }
}

chrome.runtime.onUpdateAvailable.addListener(async ({ version }) => {
  await chrome.storage.local.set({ [PENDING_KEY]: version || 'new' });
  applyIfIdle();
});

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  const { [REOPEN_KEY]: reopen } = await chrome.storage.local.get(REOPEN_KEY);
  await chrome.storage.local.remove([PENDING_KEY, REOPEN_KEY]);
  if (reason !== 'update') return;
  const version = chrome.runtime.getManifest().version;
  if (previousVersion && previousVersion !== version) {
    await chrome.storage.local.set({ [UPDATED_KEY]: { from: previousVersion, to: version } });
  }
  if (reopen) chrome.tabs.create({}).catch(() => {});
});

// The last CoolDesk page can go away two ways: its tab closes, or — far more
// often — the user types a URL into the CoolDesk new tab, which navigates it
// away without any tab being removed. Watch both. Debounced and delayed a
// beat, because getContexts() can still list a page for a moment after its
// tab closed or navigated, and a too-early check would wait for the next 3h
// alarm instead.
let idleCheckTimer = null;
function scheduleIdleCheck() {
  clearTimeout(idleCheckTimer);
  idleCheckTimer = setTimeout(() => { applyIfIdle(); }, 1500);
}
chrome.tabs.onRemoved.addListener(scheduleIdleCheck);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) scheduleIdleCheck();
});

chrome.alarms.get(CHECK_ALARM, (existing) => {
  if (!existing) chrome.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: 180 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CHECK_ALARM) return;
  checkStore();
  applyIfIdle();
});

chrome.runtime.onStartup?.addListener(checkStore);
