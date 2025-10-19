import React from 'react';

/**
 * Default Layout - Simple passthrough that renders App.jsx content as-is
 * No modifications, just renders children directly
 */
export function DefaultLayout({ children }) {
  // Simply return children without any wrapper or modifications
  return <>{children}</>;
}

export default DefaultLayout;
