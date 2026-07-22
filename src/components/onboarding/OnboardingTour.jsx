import { faArrowRight, faDiagramProject, faGear, faGripLines, faMagnifyingGlass, faTableColumns, faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EXTENSION_INSTALL_URL } from '../../config/features';
import { isElectronApp } from '../../services/environmentDetector';
import { getHostTabs } from '../../services/extensionApi';
import { ensureFontLoaded, fontFamilies, setAndSaveFontFamily } from '../../utils/fontUtils';
import { IS_MAC, accelTokens, appKey } from '../../utils/platformKeys';
// CSS is imported in App.jsx to avoid lazy-load preload issues

/* ------------------------------------------------------------------ *
 * Step 1 data — a short, curated slice of the full Settings pickers.
 * The complete lists still live in ThemesTab / FontFamilyDropdown; this
 * is deliberately the "pick one and move on" version.
 * ------------------------------------------------------------------ */

const THEME_CHOICES = [
  { id: 'ai-midnight-nebula', name: 'Midnight', font: 'inter', preview: 'radial-gradient(60% 80% at 10% 10%, #60a5fa1f, #0000 60%), radial-gradient(50% 60% at 90% 20%, #8b5cf61f, #0000 60%), linear-gradient(180deg, #0a0a0f 0%, #121218 100%)' },
  { id: 'cosmic-aurora', name: 'Aurora', font: 'poppins', preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #06b6d420, #0000 60%), linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' },
  { id: 'sunset-horizon', name: 'Sunset', font: 'roboto', preview: 'radial-gradient(60% 80% at 10% 70%, #f9731620, #0000 60%), radial-gradient(50% 60% at 90% 30%, #ec489920, #0000 60%), linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' },
  { id: 'forest-depths', name: 'Forest', font: 'system', preview: 'radial-gradient(60% 80% at 30% 20%, #059f4620, #0000 60%), radial-gradient(50% 60% at 70% 80%, #047c3a20, #0000 60%), linear-gradient(180deg, #0f1419 0%, #1a2332 100%)' },
  { id: 'minimal-dark', name: 'Minimal', font: 'inter', preview: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)' },
  { id: 'royal-purple', name: 'Royal', font: 'poppins', preview: 'radial-gradient(60% 80% at 20% 30%, #8b5cf620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #a855f720, #0000 60%), linear-gradient(180deg, #1e1b3a 0%, #2d1b69 100%)' },
  { id: 'neon-cyberpunk', name: 'Neon', font: 'jetbrains', preview: 'radial-gradient(60% 50% at 30% 20%, #ec489920, #0000 65%), radial-gradient(40% 60% at 70% 80%, #06b6d420, #0000 70%), linear-gradient(135deg, #0a0a0f 0%, #2a1a2a 100%)' },
  { id: 'arctic-frost', name: 'Arctic', font: 'inter', preview: 'radial-gradient(40% 50% at 30% 20%, #14b8a615, #0000 70%), radial-gradient(60% 40% at 70% 80%, #5eead415, #0000 60%), linear-gradient(155deg, #0f1b1a 0%, #2d4a42 100%)' },
];

// The first 8 of the 40 curated wallpapers in ThemesTab. These are plain
// Unsplash CDN image URLs — no API key, no request — so they work on first run.
const WALLPAPER_CHOICES = [
  { id: 1, name: 'Misty Valley', url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&q=80' },
  { id: 2, name: 'Northern Lights', url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=400&q=80' },
  { id: 3, name: 'Starry Sky', url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=80' },
  { id: 4, name: 'Mountain Sunset', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80' },
  { id: 5, name: 'Dark Cosmos', url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80' },
  { id: 6, name: 'Enchanted Forest', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&q=80' },
  { id: 7, name: 'Minimal Desk', url: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&q=80' },
  { id: 8, name: 'Mountain Mirror', url: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=3840&q=90&fm=jpg', thumbnail: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=400&q=80' },
];

const FONT_CHOICES = ['system', 'inter', 'poppins', 'dm-sans', 'lora', 'jetbrains'];

// Every theme id the app knows about, so switching can clear the previous one.
// Kept in sync with ThemesTab's `themes` list.
const ALL_THEME_IDS = [
  'wallpaper-custom', 'ai-midnight-nebula', 'cosmic-aurora', 'sunset-horizon', 'forest-depths',
  'minimal-dark', 'ocean-depths', 'cherry-blossom', 'arctic-frost', 'volcanic-ember',
  'neon-cyberpunk', 'white-cred', 'orange-warm', 'brown-earth', 'royal-purple',
  'golden-honey', 'mint-sage', 'crimson-fire',
];

// Same body/html class swap SettingsModal does, so the choice made here is the
// one Settings shows later.
const applyTheme = (themeId) => {
  const { body, documentElement: html } = document;
  ALL_THEME_IDS.forEach(id => { body.classList.remove(`bg-${id}`); html.classList.remove(`bg-${id}`); });
  body.classList.add(`bg-${themeId}`);
  html.classList.add(`bg-${themeId}`);
  try {
    localStorage.setItem('cooldesk-theme', themeId);
    window.dispatchEvent(new CustomEvent('cooldesk-theme-changed', { detail: { themeId } }));
  } catch { /* storage disabled — the class swap above still applies */ }
};

// In-app shortcut key. Every handler behind these tests `ctrlKey || metaKey`,
// so "Ctrl" renders as ⌘ on macOS.
const Kbd = ({ children }) => <span className="ob-kbd">{appKey(children)}</span>;

/* ------------------------------------------------------------------ *
 * Step 1 — theme + font
 * ------------------------------------------------------------------ */

function StepLook({ theme, font, wallpaper, onTheme, onFont, onWallpaper }) {
  // Gradients and photos are mutually exclusive backgrounds, so they share one
  // grid rather than stacking two — step 1 stays a single screen either way.
  const [bgMode, setBgMode] = useState(wallpaper.enabled ? 'photo' : 'gradient');

  // Load the previews so each pill renders in its own typeface
  useEffect(() => { FONT_CHOICES.forEach(ensureFontLoaded); }, []);

  const fonts = useMemo(
    () => FONT_CHOICES.map(id => fontFamilies.find(f => f.id === id)).filter(Boolean),
    []
  );

  return (
    <div className="ob-step">
      <div className="ob-field">
        <div className="ob-field-head">
          <div className="ob-field-label">Background</div>
          <div className="ob-segment">
            <button
              type="button"
              className={bgMode === 'gradient' ? 'is-active' : ''}
              onClick={() => setBgMode('gradient')}
            >
              Gradients
            </button>
            <button
              type="button"
              className={bgMode === 'photo' ? 'is-active' : ''}
              onClick={() => setBgMode('photo')}
            >
              Photos
            </button>
          </div>
        </div>

        {bgMode === 'gradient' ? (
          <div className="ob-theme-grid">
            {THEME_CHOICES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`ob-theme${!wallpaper.enabled && theme === t.id ? ' is-selected' : ''}`}
                onClick={() => onTheme(t)}
                title={t.name}
              >
                <span className="ob-theme-swatch" style={{ background: t.preview }} />
                <span className="ob-theme-name">{t.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ob-theme-grid">
            {WALLPAPER_CHOICES.map(w => (
              <button
                key={w.id}
                type="button"
                className={`ob-theme${wallpaper.enabled && wallpaper.url === w.url ? ' is-selected' : ''}`}
                onClick={() => onWallpaper(w)}
                title={w.name}
              >
                <span className="ob-theme-swatch ob-theme-photo">
                  <img src={w.thumbnail} alt="" loading="lazy" decoding="async" />
                </span>
                <span className="ob-theme-name">{w.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ob-field">
        <div className="ob-field-label">Font</div>
        <div className="ob-font-row">
          {fonts.map(f => (
            <button
              key={f.id}
              type="button"
              className={`ob-font${font === f.id ? ' is-selected' : ''}`}
              style={{ fontFamily: f.family }}
              onClick={() => onFont(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <p className="ob-note">Applies instantly. 40 more photos, your own image, and font size all live in Settings.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Optional step — connect the browser extension
 *
 * Only shown when no tabs have ever been pushed to the sidecar. Tabs can only
 * come from an extension, so an empty /tabs means the browser side isn't
 * hooked up — though not necessarily that it's uninstalled (the browser may
 * just be closed), which is why this offers rather than accuses.
 * ------------------------------------------------------------------ */

function StepExtension({ state, onInstall }) {
  const connected = state === 'connected';

  return (
    <div className="ob-step">
      <div className={`ob-connect${connected ? ' is-connected' : ''}`}>
        <span className="ob-connect-dot" />
        <span>{connected ? 'Browser connected — tabs are syncing' : 'Waiting for your browser…'}</span>
      </div>

      <ul className="ob-list">
        <li>
          <FontAwesomeIcon icon={faTableColumns} className="ob-list-icon" />
          <div>
            <strong>Your tabs on the Active screen</strong>
            <span>Every open tab across Chrome, Edge and Brave, grouped and searchable next to your apps.</span>
          </div>
        </li>
        <li>
          <FontAwesomeIcon icon={faMagnifyingGlass} className="ob-list-icon" />
          <div>
            <strong>Tabs in Spotlight</strong>
            <span>Jump straight to an open tab from the summon key, without hunting through windows.</span>
          </div>
        </li>
      </ul>

      {!connected && (
        <button type="button" className="ob-btn primary ob-connect-cta" onClick={onInstall}>
          Get the browser extension
        </button>
      )}

      <p className="ob-note">
        {connected
          ? 'Nothing else to do here.'
          : 'This page updates on its own once the extension connects — no need to start over. You can also skip and install later.'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2 — the global summon hotkey
 * ------------------------------------------------------------------ */

// Offered instead of an empty recorder: one tap accepts a working default.
// Stored as cross-platform accelerator strings — Tauri maps "Alt" to Option on
// macOS — so only the *labels* differ per platform, never the values.
// Alt+Space is ⌥Space on macOS (Raycast's default) and matches PowerToys Run on
// Windows; Alt+K is what the backend registers at startup.
// Cmd+Space is deliberately absent: macOS already owns it for Spotlight.
const HOTKEY_PRESETS = ['Alt+K', 'Alt+Space', 'Ctrl+Shift+Space'];

// One key of a global accelerator, where each modifier means itself
// (Alt → ⌥, Ctrl → ⌃ on macOS) rather than the ctrl-or-cmd of in-app shortcuts.
const AccelKbd = ({ token }) => <span className="ob-kbd">{token.label}</span>;

const formatAccel = (accelerator) =>
  accelTokens(accelerator).map(t => t.label).join(IS_MAC ? '' : ' + ');

// Mirrors SettingsModal's normalizer so both recorders emit the same strings
// the Rust `set_spotlight_shortcut` parser expects.
const normalizeShortcutKey = (key) => {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key === 'ArrowUp') return 'Up';
  if (key === 'ArrowDown') return 'Down';
  if (key === 'ArrowLeft') return 'Left';
  if (key === 'ArrowRight') return 'Right';
  if (key === 'Esc') return 'Escape';
  if (key === '+') return 'Plus';
  if (key.length === 1) return key.toUpperCase();
  return key;
};

function StepHotkey({ hotkey, isRecording, error, onPick, onStartRecording }) {
  return (
    <div className="ob-step">
      <div className={`ob-hotkey-display${isRecording ? ' is-recording' : ''}`}>
        {isRecording ? (
          <span className="ob-hotkey-prompt">Press any combination…</span>
        ) : (
          <span className="ob-hotkey-combo">
            {accelTokens(hotkey).map(token => <AccelKbd key={token.raw} token={token} />)}
          </span>
        )}
      </div>

      <div className="ob-field">
        <div className="ob-field-label">Summon key</div>
        <div className="ob-font-row">
          {HOTKEY_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              className={`ob-font${!isRecording && hotkey === preset ? ' is-selected' : ''}`}
              onClick={() => onPick(preset)}
            >
              {formatAccel(preset)}
            </button>
          ))}
          <button
            type="button"
            className={`ob-font${isRecording ? ' is-selected' : ''}`}
            onClick={onStartRecording}
          >
            Record your own…
          </button>
        </div>
      </div>

      {error && <p className="ob-error">{error}</p>}

      <p className="ob-lead">
        This works everywhere — not just inside CoolDesk. Hit it from your editor, your
        browser, anywhere, and search your apps, tabs and files without switching windows first.
      </p>

      <p className="ob-note">Escape cancels recording. You can change this any time in Settings.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 3 — the dock button in the top bar
 * ------------------------------------------------------------------ */

function StepDock({ isDesktop }) {
  return (
    <div className="ob-step">
      {/* Miniature of the real top bar, with the dock button called out */}
      <div className="ob-topbar-mock">
        <span className="ob-mock-logo" />
        <span className="ob-mock-search">Search anything…</span>
        <span className="ob-mock-btns">
          <span className="ob-mock-btn is-pulsing"><FontAwesomeIcon icon={faTableColumns} /></span>
          <span className="ob-mock-btn"><FontAwesomeIcon icon={faDiagramProject} /></span>
          <span className="ob-mock-btn"><FontAwesomeIcon icon={faGear} /></span>
        </span>
      </div>

      <p className="ob-lead">That one button cycles CoolDesk through three layouts. Keep clicking to come back around.</p>

      <ul className="ob-list">
        <li>
          <FontAwesomeIcon icon={faWindowMaximize} className="ob-list-icon" />
          <div>
            <strong>Full window</strong>
            <span>The normal app, the way you're seeing it now.</span>
          </div>
        </li>
        <li>
          <FontAwesomeIcon icon={faTableColumns} className="ob-list-icon" />
          <div>
            <strong>Side dock</strong>
            <span>Pins CoolDesk to the edge of your screen as a slim always-there panel. It reserves the space, so your other windows resize around it instead of covering it.</span>
          </div>
        </li>
        <li>
          <FontAwesomeIcon icon={faGripLines} className="ob-list-icon" />
          <div>
            <strong>Bottom bar</strong>
            <span>Same idea, but a thin strip along the bottom of the screen.</span>
          </div>
        </li>
      </ul>

      <div className="ob-shortcuts">
        <div className="ob-shortcut"><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>D</Kbd><span>Cycle layouts without reaching for the button</span></div>
      </div>

      {!isDesktop && (
        <p className="ob-note">Docking is a desktop-app feature — install CoolDesk for Windows or macOS to use it.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 3 — moving around the three screens
 * ------------------------------------------------------------------ */

// Only the faces that are actually reachable. The third one (Spaces/Team) is
// behind TEAM_FEATURE_ENABLED, so it stays out of onboarding until it ships.
//
// The pairing is the point: Collections is what you curated, Active is what the
// machine is doing right now. "Active" covers apps, tabs, folders and dev
// servers — everything TabManagement actually renders, not just tabs.
const FACES = [
  { key: 'collections', name: 'Collections', blurb: 'Projects you put together — links, apps, notes', combo: '1' },
  { key: 'active', name: 'Active', blurb: 'Everything open right now — apps, tabs, folders', combo: '2' },
];

function StepMoves() {
  // Cycle the highlighted face so the swipe idea reads at a glance
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive(i => (i + 1) % FACES.length), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="ob-step">
      <div className="ob-faces">
        {FACES.map((f, i) => (
          <div key={f.key} className={`ob-face${i === active ? ' is-active' : ''}`}>
            <div className="ob-face-name">{f.name}</div>
            <div className="ob-face-blurb">{f.blurb}</div>
            <div className="ob-face-combo"><Kbd>Ctrl</Kbd><Kbd>{f.combo}</Kbd></div>
          </div>
        ))}
        <div className="ob-swipe-hint">
          <span className="ob-swipe-fingers">✋</span>
          <span>Three-finger swipe left / right to slide between them</span>
        </div>
      </div>

      <div className="ob-shortcuts">
        <div className="ob-shortcut"><Kbd>Ctrl</Kbd><Kbd>K</Kbd><span>Quick add — drop a link or app into a workspace</span></div>
        <div className="ob-shortcut"><Kbd>Shift</Kbd><span>+ scroll wheel does the same as the swipe, on a mouse</span></div>
      </div>

      <p className="ob-note">That's it. Everything else you'll find as you go.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

const ALL_STEPS = [
  { id: 'look', emoji: '🎨', title: 'Make it yours', subtitle: 'Pick a look. You can change it later in Settings.' },
  // Global shortcuts are a desktop-app capability — there's no equivalent in
  // the extension, so this step drops out there.
  { id: 'hotkey', emoji: '⌨️', title: 'Summon it from anywhere', subtitle: 'One key brings CoolDesk up over whatever you are doing.', desktopOnly: true },
  // Only for desktop users whose browser isn't hooked up yet — see buildSteps.
  { id: 'extension', emoji: '🧩', title: 'Connect your browser', subtitle: 'CoolDesk reads your tabs through a small browser extension.', desktopOnly: true },
  { id: 'dock', emoji: '📌', title: 'Keep it in reach', subtitle: 'One button in the top bar switches how CoolDesk sits on your screen.' },
  { id: 'moves', emoji: '🧭', title: 'Two screens, one gesture', subtitle: 'What you saved, and what is open right now. That is the whole model.' },
];

const buildSteps = (isDesktop, extensionState) => ALL_STEPS.filter(s => {
  if (s.desktopOnly && !isDesktop) return false;
  // Don't spend a screen telling someone to install what they already have.
  if (s.id === 'extension' && extensionState !== 'missing') return false;
  return true;
});

export function OnboardingTour({
  onComplete,
  onSkip,
  // Wallpaper lives in App state (it owns persistence + the body class), so the
  // picker here just drives those setters.
  wallpaperEnabled = false,
  wallpaperUrl = '',
  onWallpaperEnabledChange,
  onWallpaperUrlChange,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const isDesktop = useMemo(() => isElectronApp(), []);

  // 'probing' → 'connected' | 'missing'. Extensions are the only source of
  // tabs, so a non-empty /tabs proves one is installed and running.
  const [extensionState, setExtensionState] = useState(isDesktop ? 'probing' : 'connected');

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    getHostTabs()
      .then(res => {
        if (!cancelled) setExtensionState(res.ok && res.tabs?.length ? 'connected' : 'missing');
      })
      // Sidecar unreachable tells us nothing about the extension; offering the
      // install is the harmless assumption.
      .catch(() => { if (!cancelled) setExtensionState('missing'); });
    return () => { cancelled = true; };
  }, [isDesktop]);

  // Frozen once the probe settles. Rebuilding it later would renumber the steps
  // under someone mid-tour when the extension connects.
  const [steps, setSteps] = useState(null);
  useEffect(() => {
    if (steps || extensionState === 'probing') return;
    setSteps(buildSteps(isDesktop, extensionState));
  }, [steps, extensionState, isDesktop]);

  // While the extension step is on screen, keep checking so installing it
  // confirms live instead of requiring a restart of the tour.
  useEffect(() => {
    if (extensionState !== 'missing') return;
    const id = setInterval(() => {
      getHostTabs()
        .then(res => { if (res.ok && res.tabs?.length) setExtensionState('connected'); })
        .catch(() => { /* keep waiting */ });
    }, 3000);
    return () => clearInterval(id);
  }, [extensionState]);

  const STEPS = steps || [];

  // Spotlight summon hotkey. Alt+K is what the backend registers on startup,
  // so it's the honest starting value rather than a blank recorder.
  const [hotkey, setHotkey] = useState('Alt+K');
  const [isRecording, setIsRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState('');

  // Read whatever is actually registered, in case this isn't a first run
  useEffect(() => {
    if (!isDesktop || !window.electronAPI?.getSettings) return;
    let cancelled = false;
    window.electronAPI.getSettings()
      .then((s) => {
        const stored = s?.spotlightShortcut;
        if (!cancelled && typeof stored === 'string' && stored.trim()) setHotkey(stored.trim());
      })
      .catch(() => { /* keep the Alt+K default */ });
    return () => { cancelled = true; };
  }, [isDesktop]);

  const applyHotkey = useCallback(async (combo) => {
    setHotkey(combo);
    setHotkeyError('');
    try {
      const result = await window.electronAPI?.setSettings({ spotlightShortcut: combo });
      // The backend falls back to Alt+K when a combo can't be registered (e.g.
      // another app already owns it) — surface that instead of showing a lie.
      if (result?.ok === false) {
        setHotkeyError(result.error || `Couldn't register ${formatAccel(combo)} — it may be taken by another app.`);
        if (result.spotlightShortcut) setHotkey(result.spotlightShortcut);
      }
    } catch (e) {
      setHotkeyError(e?.message || 'Failed to set the shortcut.');
    }
  }, []);

  // Capture-phase listener so the recorder sees the keystroke before the
  // shell's Enter/Escape handler and before the page acts on it.
  useEffect(() => {
    if (!isRecording) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setIsRecording(false); return; }
      // Wait for a real key — modifiers alone aren't a shortcut
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      if (e.metaKey) parts.push('Meta');
      parts.push(normalizeShortcutKey(e.key));
      applyHotkey(parts.join('+'));
      setIsRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isRecording, applyHotkey]);

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cooldesk-theme') || 'ai-midnight-nebula'; }
    catch { return 'ai-midnight-nebula'; }
  });
  const [font, setFont] = useState(() => {
    try { return localStorage.getItem('cooldesk-font-family') || 'system'; }
    catch { return 'system'; }
  });

  const handleInstallExtension = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url: EXTENSION_INSTALL_URL });
    } catch {
      window.open(EXTENSION_INSTALL_URL, '_blank');
    }
  }, []);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const handleWallpaper = (w) => {
    onWallpaperUrlChange?.(w.url);
    onWallpaperEnabledChange?.(true);
  };

  const handleTheme = (t) => {
    setTheme(t.id);
    applyTheme(t.id);
    // A gradient and a photo can't both be the background — picking one drops
    // the other, the same way the Settings background-mode toggle does.
    onWallpaperEnabledChange?.(false);
    // Themes ship with a matching typeface; adopt it unless the user already
    // picked a font by hand on this screen.
    if (t.font && font === 'system') {
      setFont(t.font);
      ensureFontLoaded(t.font);
      setAndSaveFontFamily(t.font);
    }
  };

  const handleFont = (id) => {
    setFont(id);
    ensureFontLoaded(id);
    setAndSaveFontFamily(id);
  };

  // Enter advances, Escape skips — but never while the recorder has the keyboard
  useEffect(() => {
    if (isRecording) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onSkip?.(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (isLast) onComplete?.(); else setStepIndex(i => i + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLast, onComplete, onSkip, isRecording]);

  // Hold the card back for the one localhost round-trip the probe needs, so the
  // step count never changes after it is first shown.
  if (!step) return null;

  return (
    <div className="ob-backdrop" role="dialog" aria-modal="true" aria-label="Getting started">
      <div className="ob-card">
        <header className="ob-head">
          <span className="ob-emoji">{step.emoji}</span>
          <div className="ob-head-text">
            <h2 className="ob-title">{step.title}</h2>
            <p className="ob-subtitle">{step.subtitle}</p>
          </div>
          <div className="ob-dots">
            {STEPS.map((s, i) => (
              <span key={s.id} className={`ob-dot${i === stepIndex ? ' is-active' : ''}${i < stepIndex ? ' is-done' : ''}`} />
            ))}
          </div>
        </header>

        <div className="ob-body">
          {step.id === 'look' && (
            <StepLook
              theme={theme}
              font={font}
              wallpaper={{ enabled: wallpaperEnabled, url: wallpaperUrl }}
              onTheme={handleTheme}
              onFont={handleFont}
              onWallpaper={handleWallpaper}
            />
          )}
          {step.id === 'hotkey' && (
            <StepHotkey
              hotkey={hotkey}
              isRecording={isRecording}
              error={hotkeyError}
              onPick={applyHotkey}
              onStartRecording={() => { setHotkeyError(''); setIsRecording(true); }}
            />
          )}
          {step.id === 'extension' && (
            <StepExtension state={extensionState} onInstall={handleInstallExtension} />
          )}
          {step.id === 'dock' && <StepDock isDesktop={isDesktop} />}
          {step.id === 'moves' && <StepMoves />}
        </div>

        <footer className="ob-foot">
          <button type="button" className="ob-btn ghost" onClick={() => onSkip?.()}>Skip</button>
          <div className="ob-foot-right">
            {stepIndex > 0 && (
              <button type="button" className="ob-btn ghost" onClick={() => setStepIndex(i => i - 1)}>Back</button>
            )}
            <button
              type="button"
              className="ob-btn primary"
              onClick={() => { if (isLast) onComplete?.(); else setStepIndex(i => i + 1); }}
            >
              {isLast ? 'Start using CoolDesk' : 'Next'}
              {!isLast && <FontAwesomeIcon icon={faArrowRight} />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default OnboardingTour;
