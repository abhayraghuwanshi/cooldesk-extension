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

  // Set CSS custom property on document root for theme calculations
  document.documentElement.style.setProperty('--base-font-size', fontSizeObj.size);

  // Also set directly on body for immediate effect
  document.body.style.fontSize = fontSizeObj.size;

  console.log('Applied base font size:', fontSizeObj.size);
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