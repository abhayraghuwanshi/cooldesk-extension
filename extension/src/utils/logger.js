// Simple opt-in logger for Voice Navigation
// Enable with: localStorage.setItem('debug:voice', '1')
// Disable with: localStorage.removeItem('debug:voice') or set to '0'

let volatileFlag = false;

function isEnabled() {
  try {
    const v = (typeof localStorage !== 'undefined') ? localStorage.getItem('debug:voice') : null;
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return !!volatileFlag || (typeof window !== 'undefined' && !!window.DEBUG_VOICE);
}

export function setVoiceLog(enabled) {
  volatileFlag = !!enabled;
  try {
    if (enabled) localStorage.setItem('debug:voice', '1');
    else localStorage.setItem('debug:voice', '0');
  } catch {}
}

export function voiceLog(level, ...args) {
  if (!isEnabled()) return;
  const ts = new Date().toISOString();
  const prefix = `[VoiceNav ${ts}]`;
  try {
    switch (level) {
      case 'debug':
        console.debug(prefix, ...args);
        break;
      case 'info':
        console.info(prefix, ...args);
        break;
      case 'warn':
        console.warn(prefix, ...args);
        break;
      case 'error':
        console.error(prefix, ...args);
        break;
      default:
        console.log(prefix, ...args);
    }
  } catch {}
}

export const vDebug = (...args) => voiceLog('debug', ...args);
export const vInfo = (...args) => voiceLog('info', ...args);
export const vWarn = (...args) => voiceLog('warn', ...args);
export const vError = (...args) => voiceLog('error', ...args);
