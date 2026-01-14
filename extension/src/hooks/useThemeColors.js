import { useState, useEffect } from 'react';

const getThemeColors = (theme) => {
  const themes = {
    'ai-midnight-nebula': {
      primaryBg: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
      cardBg: 'rgba(15, 23, 42, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#34C759'
    },
    'cosmic-aurora': {
      primaryBg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      cardBg: 'rgba(15, 23, 42, 0.95)',
      buttonBg: 'rgba(16, 185, 129, 0.12)',
      buttonBgHover: 'rgba(16, 185, 129, 0.18)',
      buttonBorder: 'rgba(16, 185, 129, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#10b981'
    },
    'deep-ocean': {
      primaryBg: 'linear-gradient(135deg, #164e63 0%, #0891b2 100%)',
      cardBg: 'rgba(8, 51, 68, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#0891b2'
    },
    'sunset-glow': {
      primaryBg: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)',
      cardBg: 'rgba(124, 45, 18, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#f97316'
    },
    'forest-whisper': {
      primaryBg: 'linear-gradient(135deg, #15803d 0%, #166534 100%)',
      cardBg: 'rgba(20, 83, 45, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#22c55e'
    },
    'royal-purple': {
      primaryBg: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
      cardBg: 'rgba(88, 28, 135, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#a855f7'
    },
    'electric-blue': {
      primaryBg: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
      cardBg: 'rgba(30, 58, 138, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#3b82f6'
    },
    'warm-amber': {
      primaryBg: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
      cardBg: 'rgba(146, 64, 14, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#fbbf24'
    },
    'rose-gold': {
      primaryBg: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)',
      cardBg: 'rgba(159, 18, 57, 0.95)',
      buttonBg: 'rgba(255, 255, 255, 0.12)',
      buttonBgHover: 'rgba(255, 255, 255, 0.18)',
      buttonBorder: 'rgba(255, 255, 255, 0.25)',
      textColor: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      accentColor: '#fb7185'
    }
  };
  return themes[theme] || themes['ai-midnight-nebula'];
};

export const useThemeColors = () => {
  const [currentTheme, setCurrentTheme] = useState('ai-midnight-nebula');

  useEffect(() => {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('cooldesk-theme');
    if (savedTheme) {
      setCurrentTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    // Listen for theme changes
    const handleStorageChange = (e) => {
      if (e.key === 'cooldesk-theme') {
        setCurrentTheme(e.newValue || 'ai-midnight-nebula');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for custom theme change events
    const handleThemeChange = (e) => {
      setCurrentTheme(e.detail || 'ai-midnight-nebula');
    };
    
    window.addEventListener('themeChanged', handleThemeChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('themeChanged', handleThemeChange);
    };
  }, []);

  const themeColors = getThemeColors(currentTheme);

  return { currentTheme, themeColors };
};