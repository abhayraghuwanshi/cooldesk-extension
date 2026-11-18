import { useEffect, useRef } from 'react';

// Opening Settings at a given section from elsewhere — the spotlight's
// /settings, /theme, /backup… commands (desktop app only).
//
// Inside a CoolDesk window the window's own opener is used (registered by
// CoolDeskContainer: a Browse tab, or the modal at sidebar width). From the
// spotlight overlay window there's no Settings to open, so the request goes
// through the backend (`spotlight_open_settings` in lib.rs), which shows the
// main window and leaves the section in a pending slot that
// useSpotlightSettings below takes.
//
// The section itself waits here until a SettingsModal mounts and takes it,
// or — when Settings is already open — is pushed to it by event.

export const SETTINGS_SECTIONS = ['general', 'windows', 'appearance', 'local-ai', 'folders', 'team', 'data'];

const SECTION_EVENT = 'cooldesk-settings-section';
let pendingSection = null;

/** SettingsModal: the section someone asked for before it mounted, once. */
export function takeSettingsSection() {
    const s = pendingSection;
    pendingSection = null;
    return s;
}

/** SettingsModal: follow requests made while it's open. */
export function useSettingsSectionRequests(onSection) {
    const ref = useRef(onSection);
    ref.current = onSection;
    useEffect(() => {
        const handler = (e) => {
            if (!e.detail?.section) return;
            pendingSection = null;
            ref.current?.(e.detail.section);
        };
        window.addEventListener(SECTION_EVENT, handler);
        return () => window.removeEventListener(SECTION_EVENT, handler);
    }, []);
}

function showSectionHere(section, opener) {
    pendingSection = section || 'general';
    opener();
    // Already-open Settings won't remount — tell it directly.
    window.dispatchEvent(new CustomEvent(SECTION_EVENT, { detail: { section: pendingSection } }));
}

/** Host window (CoolDeskContainer): how Settings opens here. */
export function registerSettingsOpener(fn) {
    window.__cooldeskOpenSettings = fn;
    return () => {
        if (window.__cooldeskOpenSettings === fn) delete window.__cooldeskOpenSettings;
    };
}

/** Open Settings at `section`, from any desktop window. */
export async function openSettingsSection(section = 'general') {
    const opener = window.__cooldeskOpenSettings;
    if (typeof opener === 'function') {
        showSectionHere(section, opener);
        return;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('spotlight_open_settings', { section });
}

/** Main window: take sections the spotlight window handed over — on mount
 *  (the window may only just have been created for it) and on each nudge. */
export function useSpotlightSettings(enabled) {
    useEffect(() => {
        if (!enabled || !window.__TAURI_INTERNALS__) return undefined;
        let cancelled = false;
        let unlisten = null;
        const take = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const section = await invoke('take_settings_open');
                if (!section || cancelled) return;
                const opener = window.__cooldeskOpenSettings;
                if (typeof opener === 'function') showSectionHere(section, opener);
            } catch (e) {
                console.warn('[Settings] take_settings_open failed:', e);
            }
        };
        take();
        import('@tauri-apps/api/event')
            .then(({ listen }) => listen('spotlight-open-settings', take))
            .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
            .catch(() => { });
        return () => { cancelled = true; unlisten?.(); };
    }, [enabled]);
}
