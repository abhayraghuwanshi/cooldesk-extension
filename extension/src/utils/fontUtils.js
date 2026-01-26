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

// Font family options
export const fontFamilies = [
  { id: 'system', name: 'System Default', family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif', description: 'Native system fonts' },
  { id: 'inter', name: 'Inter', family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Modern geometric sans-serif' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Google\'s friendly sans-serif' },
  { id: 'poppins', name: 'Poppins', family: 'Poppins, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Rounded geometric typeface' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: 'JetBrains Mono, Consolas, Monaco, monospace', description: 'Developer-focused monospace' }
];

/**
 * Apply font family to the document root
 * @param {string} fontFamilyId - The font family ID
 */
export const applyFontFamily = (fontFamilyId) => {
  const fontObj = fontFamilies.find(f => f.id === fontFamilyId) || fontFamilies[0];

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