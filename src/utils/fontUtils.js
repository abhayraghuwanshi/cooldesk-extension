/**
 * Font utility functions for dynamic font size management
 */

// Font size configurations matching ThemesTab.jsx
export const fontSizes = [
  { id: 'small', name: 'Small', size: '13px', description: 'Compact text for more content' },
  { id: 'medium', name: 'Medium', size: '14px', description: 'Default comfortable reading' },
  { id: 'large', name: 'Large', size: '16px', description: 'Easier reading, larger text' },
  { id: 'extra-large', name: 'Extra Large', size: '18px', description: 'Maximum readability' }

];

/**
 * Apply base font size to the document root for CSS variable calculations
 * @param {string} fontSizeId - The font size ID (small, medium, large, extra-large)
 */
export const applyBaseFontSize = (fontSizeId) => {
  const fontSizeObj = fontSizes.find(f => f.id === fontSizeId);
  if (!fontSizeObj) {
    console.warn('Font size not found:', fontSizeId);
    return;
  }

  const baseSize = parseInt(fontSizeObj.size);

  // Set comprehensive CSS custom properties on document root
  document.documentElement.style.setProperty('--base-font-size', fontSizeObj.size);

  // Font scale variables (standardized progression)
  document.documentElement.style.setProperty('--font-xs', `${Math.round(baseSize * 0.75)}px`);   // ~10-11px (Tiny)
  document.documentElement.style.setProperty('--font-sm', `${Math.round(baseSize * 0.85)}px`);   // ~12px (Small)
  document.documentElement.style.setProperty('--font-md', `${Math.round(baseSize * 0.92)}px`);   // ~13px (Medium-Small)
  document.documentElement.style.setProperty('--font-base', `${Math.round(baseSize * 0.95)}px`); // ~13-14px (Secondary)
  document.documentElement.style.setProperty('--font-xl', `${Math.round(baseSize * 1.0)}px`);    // ~14-16px (Base/Current)
  document.documentElement.style.setProperty('--font-lg', `${Math.round(baseSize * 1.15)}px`);   // ~16-18px (Large)
  document.documentElement.style.setProperty('--font-2xl', `${Math.round(baseSize * 1.3)}px`);   // ~18-21px (Subtitle)
  document.documentElement.style.setProperty('--font-3xl', `${Math.round(baseSize * 1.6)}px`);   // ~22-26px (Title)
  document.documentElement.style.setProperty('--font-4xl', `${Math.round(baseSize * 2.1)}px`);   // ~28-34px (Heading)
  document.documentElement.style.setProperty('--font-5xl', `${Math.round(baseSize * 2.8)}px`);   // ~38-45px (Hero)

  // Icon size variables (scales with font size for consistency)
  document.documentElement.style.setProperty('--icon-xs', `${Math.round(baseSize * 1.0)}px`);    // ~14-18px (Tiny icons)
  document.documentElement.style.setProperty('--icon-sm', `${Math.round(baseSize * 1.3)}px`);    // ~17-23px (Small icons)
  document.documentElement.style.setProperty('--icon-md', `${Math.round(baseSize * 1.6)}px`);    // ~21-29px (Medium icons)
  document.documentElement.style.setProperty('--icon-lg', `${Math.round(baseSize * 2.0)}px`);    // ~26-36px (Large icons)
  document.documentElement.style.setProperty('--icon-xl', `${Math.round(baseSize * 2.5)}px`);    // ~33-45px (Extra large icons)
  document.documentElement.style.setProperty('--icon-2xl', `${Math.round(baseSize * 3.0)}px`);   // ~39-54px (Huge icons)

  // Icon container sizes (for favicon containers with padding)
  document.documentElement.style.setProperty('--icon-container-sm', `${Math.round(baseSize * 1.8)}px`);  // ~24-32px
  document.documentElement.style.setProperty('--icon-container-md', `${Math.round(baseSize * 2.4)}px`);  // ~32-43px
  document.documentElement.style.setProperty('--icon-container-lg', `${Math.round(baseSize * 3.0)}px`);  // ~39-54px
  document.documentElement.style.setProperty('--icon-container-xl', `${Math.round(baseSize * 3.5)}px`);  // ~46-63px

  // Also set directly on body for immediate effect
  document.body.style.fontSize = fontSizeObj.size;

  console.log('Applied base font size:', fontSizeObj.size, 'with scale variables');
};

/**
 * Get the current font size setting from localStorage
 * @returns {string} The current font size ID or default 'medium'
 */
export const getCurrentFontSize = () => {
  try {
    return localStorage.getItem('cooldesk-font-size') || 'medium';
  } catch (e) {
    console.warn('Failed to get font size from localStorage:', e);
    return 'medium';
  }
};

/**
 * Save font size setting to localStorage and apply it
 * @param {string} fontSizeId - The font size ID to save and apply
 */
export const setAndSaveFontSize = (fontSizeId) => {
  try {
    localStorage.setItem('cooldesk-font-size', fontSizeId);
    applyBaseFontSize(fontSizeId);
  } catch (e) {
    console.error('Failed to save font size:', e);
  }
};


// Default font family using CSS variable for dynamic updates
export const defaultFontFamily = 'var(--font-family-base)';

// Fallback stacks appended after each web font, per category
const SANS_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const MONO_FALLBACK = 'Consolas, Monaco, "Courier New", monospace';

/**
 * Font family options.
 * `google` is the Google Fonts family spec (with weights) loaded on demand the
 * first time the font is applied or previewed — see ensureFontLoaded(). Omit
 * `google` for fonts that need no network load (e.g. system default).
 * `category` groups fonts in the picker dropdown.
 */
export const fontFamilies = [
  // System
  { id: 'system', name: 'System Default', category: 'System', family: `-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`, description: 'Native system fonts' },

  // Sans-serif
  { id: 'inter', name: 'Inter', category: 'Sans-serif', google: 'Inter:wght@300;400;500;600;700', family: `Inter, ${SANS_FALLBACK}`, description: 'Modern geometric sans-serif' },
  { id: 'roboto', name: 'Roboto', category: 'Sans-serif', google: 'Roboto:wght@400;500;700', family: `Roboto, ${SANS_FALLBACK}`, description: "Google's friendly sans-serif" },
  { id: 'poppins', name: 'Poppins', category: 'Sans-serif', google: 'Poppins:wght@400;500;600;700', family: `Poppins, ${SANS_FALLBACK}`, description: 'Rounded geometric typeface' },
  { id: 'open-sans', name: 'Open Sans', category: 'Sans-serif', google: 'Open+Sans:wght@400;500;600;700', family: `"Open Sans", ${SANS_FALLBACK}`, description: 'Neutral, highly legible' },
  { id: 'lato', name: 'Lato', category: 'Sans-serif', google: 'Lato:wght@400;700', family: `Lato, ${SANS_FALLBACK}`, description: 'Warm humanist sans' },
  { id: 'montserrat', name: 'Montserrat', category: 'Sans-serif', google: 'Montserrat:wght@400;500;600;700', family: `Montserrat, ${SANS_FALLBACK}`, description: 'Urban geometric style' },
  { id: 'nunito', name: 'Nunito', category: 'Sans-serif', google: 'Nunito:wght@400;600;700', family: `Nunito, ${SANS_FALLBACK}`, description: 'Rounded and friendly' },
  { id: 'work-sans', name: 'Work Sans', category: 'Sans-serif', google: 'Work+Sans:wght@400;500;600', family: `"Work Sans", ${SANS_FALLBACK}`, description: 'Optimised for screens' },
  { id: 'dm-sans', name: 'DM Sans', category: 'Sans-serif', google: 'DM+Sans:wght@400;500;700', family: `"DM Sans", ${SANS_FALLBACK}`, description: 'Low-contrast geometric' },
  { id: 'manrope', name: 'Manrope', category: 'Sans-serif', google: 'Manrope:wght@400;500;600;700', family: `Manrope, ${SANS_FALLBACK}`, description: 'Modern, semi-condensed' },
  { id: 'rubik', name: 'Rubik', category: 'Sans-serif', google: 'Rubik:wght@400;500;600', family: `Rubik, ${SANS_FALLBACK}`, description: 'Slightly rounded corners' },

  // Serif
  { id: 'merriweather', name: 'Merriweather', category: 'Serif', google: 'Merriweather:wght@400;700', family: `Merriweather, ${SERIF_FALLBACK}`, description: 'Readable classic serif' },
  { id: 'lora', name: 'Lora', category: 'Serif', google: 'Lora:wght@400;500;600', family: `Lora, ${SERIF_FALLBACK}`, description: 'Contemporary serif' },
  { id: 'playfair', name: 'Playfair Display', category: 'Serif', google: 'Playfair+Display:wght@400;600;700', family: `"Playfair Display", ${SERIF_FALLBACK}`, description: 'Elegant high-contrast' },
  { id: 'source-serif', name: 'Source Serif', category: 'Serif', google: 'Source+Serif+4:wght@400;600', family: `"Source Serif 4", ${SERIF_FALLBACK}`, description: 'Balanced editorial serif' },

  // Monospace
  { id: 'jetbrains', name: 'JetBrains Mono', category: 'Monospace', google: 'JetBrains+Mono:wght@400;600;700', family: `"JetBrains Mono", ${MONO_FALLBACK}`, description: 'Developer-focused monospace' },
  { id: 'fira-code', name: 'Fira Code', category: 'Monospace', google: 'Fira+Code:wght@400;500;600', family: `"Fira Code", ${MONO_FALLBACK}`, description: 'Monospace with ligatures' },
  { id: 'source-code', name: 'Source Code Pro', category: 'Monospace', google: 'Source+Code+Pro:wght@400;500;600', family: `"Source Code Pro", ${MONO_FALLBACK}`, description: 'Clean coding monospace' },
];

// Track which Google Fonts have already been injected so we never load twice
const loadedGoogleFonts = new Set();

/**
 * Inject a Google Fonts stylesheet on demand for the given font object.
 * No-op for system fonts or fonts already loaded.
 * @param {object|string} fontOrId - a fontFamilies entry or its id
 */
export const ensureFontLoaded = (fontOrId) => {
  const fontObj = typeof fontOrId === 'string'
    ? fontFamilies.find(f => f.id === fontOrId)
    : fontOrId;
  if (!fontObj || !fontObj.google || loadedGoogleFonts.has(fontObj.id)) return;
  loadedGoogleFonts.add(fontObj.id);
  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${fontObj.google}&display=swap`;
    link.setAttribute('data-cooldesk-font', fontObj.id);
    document.head.appendChild(link);
  } catch (e) {
    console.warn('Failed to load font:', fontObj.name, e);
  }
};

/**
 * Apply font family to the document root
 * @param {string} fontFamilyId - The font family ID
 */
export const applyFontFamily = (fontFamilyId) => {
  const fontObj = fontFamilies.find(f => f.id === fontFamilyId) || fontFamilies[0];

  // Make sure the web font is loaded before we switch to it
  ensureFontLoaded(fontObj);

  // Set CSS custom property
  document.documentElement.style.setProperty('--font-family-base', fontObj.family);

  // Also set directly on body to ensure inheritance
  document.body.style.fontFamily = fontObj.family;

  console.log('Applied font family:', fontObj.name);
};

/**
 * Get the current font family setting from localStorage
 * @returns {string} The current font family ID
 */
export const getCurrentFontFamily = () => {
  try {
    return localStorage.getItem('cooldesk-font-family') || 'system';
  } catch (e) {
    console.warn('Failed to get font family from localStorage:', e);
    return 'system';
  }
};

/**
 * Save font family setting to localStorage and apply it
 * @param {string} fontFamilyId - The font family ID to save and apply
 */
export const setAndSaveFontFamily = (fontFamilyId) => {
  try {
    localStorage.setItem('cooldesk-font-family', fontFamilyId);
    applyFontFamily(fontFamilyId);
  } catch (e) {
    console.error('Failed to save font family:', e);
  }
};

/**
 * Initialize font settings on app startup
 */
export const initializeFontSettings = () => {
  const savedFontSize = getCurrentFontSize();
  applyBaseFontSize(savedFontSize);

  const savedFontFamily = getCurrentFontFamily();
  applyFontFamily(savedFontFamily);

  return { fontSize: savedFontSize, fontFamily: savedFontFamily };
};

/**
 * Initialize font size system on app startup (Legacy support)
 */
export const initializeFontSize = () => {
  const settings = initializeFontSettings();
  return settings.fontSize;
};