// Gradient theme presets + the one way to apply a theme. Shared by the
// new tab's Customize menu and onboarding; the full picker (with fonts and
// descriptions) is Settings → Appearance (ThemesTab), which these mirror.

export const THEME_PRESETS = [
    { id: 'ai-midnight-nebula', name: 'AI Midnight Nebula', preview: 'radial-gradient(60% 80% at 10% 10%, #60a5fa1f, #0000 60%), radial-gradient(50% 60% at 90% 20%, #8b5cf61f, #0000 60%), linear-gradient(180deg, #0a0a0f 0%, #121218 100%)' },
    { id: 'cosmic-aurora', name: 'Cosmic Aurora', preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #06b6d420, #0000 60%), linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' },
    { id: 'sunset-horizon', name: 'Sunset Horizon', preview: 'radial-gradient(60% 80% at 10% 70%, #f9731620, #0000 60%), radial-gradient(50% 60% at 90% 30%, #ec489920, #0000 60%), linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' },
    { id: 'forest-depths', name: 'Forest Depths', preview: 'radial-gradient(60% 80% at 30% 20%, #059f4620, #0000 60%), radial-gradient(50% 60% at 70% 80%, #047c3a20, #0000 60%), linear-gradient(180deg, #0f1419 0%, #1a2332 100%)' },
    { id: 'minimal-dark', name: 'Minimal Dark', preview: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)' },
    { id: 'ocean-depths', name: 'Ocean Depths', preview: 'radial-gradient(50% 60% at 20% 30%, #8b5cf620, #0000 70%), radial-gradient(40% 50% at 80% 20%, #a78bfa20, #0000 60%), linear-gradient(140deg, #1a0c26 0%, #3b1e29 100%)' },
    { id: 'cherry-blossom', name: 'Cherry Blossom', preview: 'radial-gradient(60% 70% at 25% 25%, #ec489920, #0000 65%), radial-gradient(50% 60% at 75% 15%, #a855f720, #0000 70%), linear-gradient(130deg, #1f1729 0%, #2d1b3d 100%)' },
    { id: 'arctic-frost', name: 'Arctic Frost', preview: 'radial-gradient(40% 50% at 30% 20%, #14b8a615, #0000 70%), radial-gradient(60% 40% at 70% 80%, #5eead415, #0000 60%), linear-gradient(155deg, #0f1b1a 0%, #2d4a42 100%)' },
    { id: 'volcanic-ember', name: 'Volcanic Ember', preview: 'radial-gradient(60% 80% at 30% 20%, #dc262620, #0000 60%), radial-gradient(50% 60% at 80% 40%, #ea580c20, #0000 60%), linear-gradient(140deg, #1a0f0f 0%, #2d1b1b 100%)' },
    { id: 'neon-cyberpunk', name: 'Neon Cyberpunk', preview: 'radial-gradient(60% 50% at 30% 20%, #ec489920, #0000 65%), radial-gradient(40% 60% at 70% 80%, #06b6d420, #0000 70%), linear-gradient(135deg, #0a0a0f 0%, #2a1a2a 100%)' },
    { id: 'orange-warm', name: 'Orange Warm', preview: 'radial-gradient(60% 80% at 20% 30%, #f9731620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #ea580c20, #0000 60%), linear-gradient(180deg, #2d1b1b 0%, #451a03 100%)' },
    { id: 'brown-earth', name: 'Brown Earth', preview: 'radial-gradient(60% 80% at 20% 30%, #92400e20, #0000 60%), radial-gradient(50% 60% at 80% 10%, #78350f20, #0000 60%), linear-gradient(180deg, #3c2415 0%, #451a03 100%)' },
    { id: 'royal-purple', name: 'Royal Purple', preview: 'radial-gradient(60% 80% at 20% 30%, #8b5cf620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #a855f720, #0000 60%), linear-gradient(180deg, #1e1b3a 0%, #2d1b69 100%)' },
    { id: 'golden-honey', name: 'Golden Honey', preview: 'radial-gradient(60% 80% at 20% 30%, #f59e0b20, #0000 60%), radial-gradient(50% 60% at 80% 10%, #d9770620, #0000 60%), linear-gradient(180deg, #3a2817 0%, #451a03 100%)' },
    { id: 'mint-sage', name: 'Mint Sage', preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #6ee7b720, #0000 60%), linear-gradient(180deg, #1e2e23 0%, #0f2027 100%)' },
    { id: 'crimson-fire', name: 'Crimson Fire', preview: 'radial-gradient(60% 80% at 20% 30%, #dc262620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #ef444420, #0000 60%), linear-gradient(180deg, #3c1518 0%, #220a0c 100%)' },
];

// Every theme class the app may have set, so switching clears the old one.
const ALL_THEME_IDS = ['wallpaper-custom', 'white-cred', ...THEME_PRESETS.map(t => t.id)];

// Same body/html class swap Settings does; listeners (widget theme, the page
// wrapper) hear about it through the cooldesk-theme-changed event.
export function applyTheme(themeId) {
    const { body, documentElement: html } = document;
    ALL_THEME_IDS.forEach(id => { body.classList.remove(`bg-${id}`); html.classList.remove(`bg-${id}`); });
    body.classList.add(`bg-${themeId}`);
    html.classList.add(`bg-${themeId}`);
    try {
        localStorage.setItem('cooldesk-theme', themeId);
        window.dispatchEvent(new CustomEvent('cooldesk-theme-changed', { detail: { themeId } }));
    } catch { /* storage disabled — the class swap above still applies */ }
}

export function currentTheme() {
    try { return localStorage.getItem('cooldesk-theme') || 'crimson-fire'; } catch { return 'crimson-fire'; }
}
