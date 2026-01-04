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

  // Font scale variables (based on base font size)
  document.documentElement.style.setProperty('--font-xs', `${Math.round(baseSize * 0.75)}px`);   // 75% - timestamps, icons
  document.documentElement.style.setProperty('--font-sm', `${Math.round(baseSize * 0.85)}px`);    // 85% - small buttons
  document.documentElement.style.setProperty('--font-md', `${Math.round(baseSize * 0.9)}px`);    // 90% - metadata
  document.documentElement.style.setProperty('--font-base', `${Math.round(baseSize * 0.95)}px`); // 95% - secondary text
  document.documentElement.style.setProperty('--font-lg', `${Math.round(baseSize * 1.05)}px`);   // 105% - main text
  document.documentElement.style.setProperty('--font-xl', `${Math.round(baseSize * 1)}px`);      // 100% - base
  document.documentElement.style.setProperty('--font-2xl', `${Math.round(baseSize * 1.15)}px`);  // 115% - titles
  document.documentElement.style.setProperty('--font-3xl', `${Math.round(baseSize * 1.4)}px`);   // 140% - headings
  document.documentElement.style.setProperty('--font-4xl', `${Math.round(baseSize * 1.7)}px`);   // 170% - large icons
  document.documentElement.style.setProperty('--font-5xl', `${Math.round(baseSize * 2)}px`);     // 200% - emoji icons

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

/**
 * Initialize font size system on app startup
 */
export const initializeFontSize = () => {
  const savedFontSize = getCurrentFontSize();
  applyBaseFontSize(savedFontSize);
  return savedFontSize;
};