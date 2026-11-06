import { useSyncExternalStore } from 'react';
import { MESSAGES as CORE } from './messages';
import { SETTINGS_MESSAGES } from './messages-settings';
import { DOCK_MESSAGES } from './messages-dock';

const MESSAGES = Object.fromEntries(Object.keys(CORE).map(k => [k, { ...CORE[k], ...SETTINGS_MESSAGES[k], ...DOCK_MESSAGES[k] }]));

// Tiny i18n layer: no library, all dictionaries bundled (they're a few KB).
//
//   t('cz.layout')                    -> "Layout" / "Diseño" / …
//   t('greet.week', { n: 12 })        -> "Week 12"
//   const t = useT();                 -> re-renders when the language changes
//
// Missing keys fall back to English, then to the key itself, so a string
// that hasn't been translated yet still reads fine. The choice is stored in
// localStorage ('auto' = follow the browser) and broadcast with a window
// event, so every mounted component switches without a reload.

export const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'ru', name: 'Русский' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'id', name: 'Bahasa Indonesia' },
    { code: 'hi', name: 'हिन्दी' },
    { code: 'ar', name: 'العربية', dir: 'rtl' },
    { code: 'zh', name: '简体中文' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
];

const STORAGE_KEY = 'cooldesk-language';
const EVENT = 'cooldesk-language-changed';
const SUPPORTED = new Set(LANGUAGES.map(l => l.code));

// 'pt-BR' -> 'pt', 'zh-Hans-CN' -> 'zh'; unsupported -> 'en'.
function matchBrowserLanguage() {
    const prefs = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
    for (const tag of prefs) {
        const base = String(tag || '').toLowerCase().split('-')[0];
        if (SUPPORTED.has(base)) return base;
    }
    return 'en';
}

/** The stored preference: a language code, or 'auto'. */
export function getLanguagePreference() {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v && (v === 'auto' || SUPPORTED.has(v)) ? v : 'auto';
    } catch {
        return 'auto';
    }
}

function resolve(pref) {
    return pref === 'auto' ? matchBrowserLanguage() : pref;
}

let current = resolve(getLanguagePreference());

/** The language actually in use (never 'auto'). */
export const getLanguage = () => current;

/** BCP-47 tag for Intl / toLocale*String calls. */
export const getLocale = () => (current === 'zh' ? 'zh-CN' : current);

function applyToDocument() {
    if (typeof document === 'undefined') return;
    const lang = LANGUAGES.find(l => l.code === current);
    document.documentElement.lang = getLocale();
    document.documentElement.dir = lang?.dir || 'ltr';
}
applyToDocument();

/** Set 'auto' or a language code; persists and updates every useT() caller. */
export function setLanguage(pref) {
    const next = pref === 'auto' || SUPPORTED.has(pref) ? pref : 'auto';
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* won't persist */ }
    current = resolve(next);
    applyToDocument();
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { language: current, preference: next } }));
}

// Another tab/page changed it: follow along.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        current = resolve(getLanguagePreference());
        applyToDocument();
        window.dispatchEvent(new CustomEvent(EVENT, { detail: { language: current } }));
    });
}

const interpolate = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function t(key, vars) {
    const s = MESSAGES[current]?.[key] ?? MESSAGES.en[key] ?? key;
    return interpolate(s, vars);
}

function subscribe(cb) {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
}

/** Hook: returns t, and re-renders the component when the language changes. */
export function useT() {
    useSyncExternalStore(subscribe, getLanguage, getLanguage);
    return t;
}

/** Hook: the current language code, re-rendering on change. */
export function useLanguage() {
    return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}
