<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
import { useCallback, useState } from 'react';
import { fontFamilies } from '../../utils/fontUtils';
=======

import { fontFamilies } from '../../utils/fontUtils';

>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
const ThemesTab = ({
  selectedTheme,
  fontSize,
  fontFamily,
  onThemeChange,
  onFontSizeChange,
  onFontFamilyChange,
  wallpaperEnabled = false,
  wallpaperUrl = 'https://source.unsplash.com/1920x1080/?nature',
  wallpaperOpacity = 0.3,
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
  wallpaperAutoRotate = false,
  onWallpaperEnabledChange = () => { },
  onWallpaperUrlChange = () => { },
  onWallpaperOpacityChange = () => { },
  onWallpaperAutoRotateChange = () => { },
  unsplashApiKey = '',
  onUnsplashApiKeyChange = () => { }
}) => {
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [unsplashSearchQuery, setUnsplashSearchQuery] = useState('');
  const [unsplashResults, setUnsplashResults] = useState([]);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const [unsplashError, setUnsplashError] = useState('');

  // Search Unsplash for wallpapers
  const searchUnsplash = useCallback(async (query) => {
    if (!unsplashApiKey) {
      setUnsplashError('Please enter your Unsplash API key first');
      return;
    }
    if (!query.trim()) {
      setUnsplashError('Please enter a search term');
      return;
    }

    setUnsplashLoading(true);
    setUnsplashError('');

    try {
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=12&orientation=landscape`,
        {
          headers: {
            'Authorization': `Client-ID ${unsplashApiKey}`
          }
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key. Please check your Unsplash API key.');
        }
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const data = await response.json();
      setUnsplashResults(data.results || []);

      if (data.results?.length === 0) {
        setUnsplashError('No results found. Try a different search term.');
      }
    } catch (err) {
      console.error('Unsplash search error:', err);
      setUnsplashError(err.message || 'Failed to search Unsplash');
    } finally {
      setUnsplashLoading(false);
    }
  }, [unsplashApiKey]);
=======
  onWallpaperEnabledChange = () => { },
  onWallpaperUrlChange = () => { },
  onWallpaperOpacityChange = () => { }
}) => {
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx




  // Theme options with font family pairings (includes gradient themes + customizable wallpaper theme)
  const themes = [
    {
      id: 'wallpaper-custom',
      name: 'Custom Wallpaper',
      description: 'Use your own background image',
      type: 'wallpaper',
      fontFamily: 'inter'
    },
    {
      id: 'ai-midnight-nebula',
      name: 'AI Midnight Nebula',
      description: 'Deep space theme with blue and purple nebula effects',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 10% 10%, #60a5fa1f, #0000 60%), radial-gradient(50% 60% at 90% 20%, #8b5cf61f, #0000 60%), linear-gradient(180deg, #0a0a0f 0%, #121218 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'cosmic-aurora',
      name: 'Cosmic Aurora',
      description: 'Northern lights inspired with green and teal gradients',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #06b6d420, #0000 60%), linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'sunset-horizon',
      name: 'Sunset Horizon',
      description: 'Warm sunset colors with orange and pink tones',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 10% 70%, #f9731620, #0000 60%), radial-gradient(50% 60% at 90% 30%, #ec489920, #0000 60%), linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'forest-depths',
      name: 'Forest Depths',
      description: 'Deep forest theme with emerald and jade accents',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 30% 20%, #059f4620, #0000 60%), radial-gradient(50% 60% at 70% 80%, #047c3a20, #0000 60%), linear-gradient(180deg, #0f1419 0%, #1a2332 100%)',
      fontFamily: 'system'
    },
    {
      id: 'minimal-dark',
      name: 'Minimal Dark',
      description: 'Clean minimal dark theme with subtle gradients',
      type: 'gradient',
      preview: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'ocean-depths',
      name: 'Ocean Depths',
      description: 'Deep mystical waters with purple and indigo depths',
      type: 'gradient',
      preview: 'radial-gradient(50% 60% at 20% 30%, #8b5cf620, #0000 70%), radial-gradient(40% 50% at 80% 20%, #a78bfa20, #0000 60%), linear-gradient(140deg, #1a0c26 0%, #3b1e29 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'cherry-blossom',
      name: 'Cherry Blossom',
      description: 'Soft pink and purple spring theme',
      type: 'gradient',
      preview: 'radial-gradient(60% 70% at 25% 25%, #ec489920, #0000 65%), radial-gradient(50% 60% at 75% 15%, #a855f720, #0000 70%), linear-gradient(130deg, #1f1729 0%, #2d1b3d 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'arctic-frost',
      name: 'Arctic Frost',
      description: 'Cool arctic with teal and mint ice accents',
      type: 'gradient',
      preview: 'radial-gradient(40% 50% at 30% 20%, #14b8a615, #0000 70%), radial-gradient(60% 40% at 70% 80%, #5eead415, #0000 60%), linear-gradient(155deg, #0f1b1a 0%, #2d4a42 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'volcanic-ember',
      name: 'Volcanic Ember',
      description: 'Fiery volcanic theme with red and orange embers',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 30% 20%, #dc262620, #0000 60%), radial-gradient(50% 60% at 80% 40%, #ea580c20, #0000 60%), linear-gradient(140deg, #1a0f0f 0%, #2d1b1b 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'neon-cyberpunk',
      name: 'Neon Cyberpunk',
      description: 'Futuristic cyberpunk with neon pink and cyan',
      type: 'gradient',
      preview: 'radial-gradient(60% 50% at 30% 20%, #ec489920, #0000 65%), radial-gradient(40% 60% at 70% 80%, #06b6d420, #0000 70%), linear-gradient(135deg, #0a0a0f 0%, #2a1a2a 100%)',
      fontFamily: 'jetbrains'
    },
    {
      id: 'orange-warm',
      name: 'Orange Warm',
      description: 'Warm orange theme with cozy earth tones',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #f9731620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #ea580c20, #0000 60%), linear-gradient(180deg, #2d1b1b 0%, #451a03 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'brown-earth',
      name: 'Brown Earth',
      description: 'Earthy brown theme with natural tones',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #92400e20, #0000 60%), radial-gradient(50% 60% at 80% 10%, #78350f20, #0000 60%), linear-gradient(180deg, #3c2415 0%, #451a03 100%)',
      fontFamily: 'system'
    },
    {
      id: 'royal-purple',
      name: 'Royal Purple',
      description: 'Elegant purple and lavender with gold accents',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #8b5cf620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #a855f720, #0000 60%), linear-gradient(180deg, #1e1b3a 0%, #2d1b69 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'golden-honey',
      name: 'Golden Honey',
      description: 'Warm golden yellows with amber and bronze accents',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #f59e0b20, #0000 60%), radial-gradient(50% 60% at 80% 10%, #d9770620, #0000 60%), linear-gradient(180deg, #3a2817 0%, #451a03 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'mint-sage',
      name: 'Mint Sage',
      description: 'Fresh mint and sage greens with earthy undertones',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #6ee7b720, #0000 60%), linear-gradient(180deg, #1e2e23 0%, #0f2027 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'crimson-fire',
      name: 'Crimson Fire',
      description: 'Bold red with deep crimson and rose gold accents',
      type: 'gradient',
      preview: 'radial-gradient(60% 80% at 20% 30%, #dc262620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #ef444420, #0000 60%), linear-gradient(180deg, #3c1518 0%, #220a0c 100%)',
      fontFamily: 'roboto'
    }
  ];

  // Font size options
  const fontSizes = [
    { id: 'small', name: 'Small', size: '13px', description: 'Compact text for more content' },
    { id: 'medium', name: 'Medium', size: '14px', description: 'Default comfortable reading' },
    { id: 'large', name: 'Large', size: '16px', description: 'Easier reading, larger text' },
    { id: 'extra-large', name: 'Extra Large', size: '18px', description: 'Maximum readability' }
  ];



<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
  // Curated 4K high-quality wallpapers for the application
=======
  // Curated high-quality wallpapers for the application
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
  const curatedWallpapers = [
    {
      id: 1,
      name: 'Mountain Sunset',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'nature'
    },
    {
      id: 2,
      name: 'Ocean Waves',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'nature'
    },
    {
      id: 3,
      name: 'Northern Lights',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'nature'
    },
    {
      id: 4,
      name: 'Starry Night',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'space'
    },
    {
      id: 5,
      name: 'Abstract Gradient',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'abstract'
    },
    {
      id: 6,
      name: 'Minimal Desk',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'minimal'
    },
    {
      id: 7,
      name: 'Forest Path',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'nature'
    },
    {
      id: 8,
      name: 'City Lights',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'urban'
    },
    {
      id: 9,
      name: 'Desert Dunes',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'nature'
    },
    {
      id: 10,
      name: 'Cosmic Nebula',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
      url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=3840&q=90&fm=jpg',
      thumbnail: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80',
=======
      url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=80',
      thumbnail: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=300&q=80',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
      category: 'space'
    }
  ];



  return (
    <div style={{ padding: '16px 0' }}>
      <h4 style={{
        margin: '0 0 16px 0',
        color: '#e5e7eb',
        fontSize: 'var(--font-2xl)',
        fontWeight: '600'
      }}>
        Choose Your Theme
      </h4>
      <p style={{
        margin: '0 0 24px 0',
        color: '#9ca3af',
        fontSize: 'var(--font-base)',
        lineHeight: '1.5'
      }}>
        Select a theme that matches your style. Each theme includes a carefully chosen font family. Changes apply instantly.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px'
      }}>
        {themes.slice(0, showAllThemes ? themes.length : 3).map((theme) => {
          const themeFontFamily = fontFamilies.find(f => f.id === theme.fontFamily);
          const isWallpaperTheme = theme.type === 'wallpaper';
          const isSelected = selectedTheme === theme.id;

          return (
            <div
              key={theme.id}
              onClick={() => {
                if (isWallpaperTheme) {
                  onWallpaperEnabledChange(true);
                  onThemeChange(theme.id);
                } else {
                  onWallpaperEnabledChange(false);
                  onThemeChange(theme.id);
                }
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: isSelected
                  ? '2px solid #34C759'
                  : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(10px)',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              <div style={{
                width: '100%',
                height: '50px',
                background: isWallpaperTheme ? '#1a1a1a' : theme.preview,
                borderRadius: '8px',
                marginBottom: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                position: 'relative',
                overflow: 'hidden',
                ...(isWallpaperTheme && wallpaperUrl ? {
                  backgroundImage: `url(${wallpaperUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                } : {})
              }}>
                {isWallpaperTheme && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: 'white',
                    fontSize: 'var(--font-3xl)',
                    textShadow: '0 2px 4px rgba(0,0,0,0.5)'
                  }}>
                    🖼️
                  </div>
                )}
                {isSelected && (
                  <div style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    width: '18px',
                    height: '18px',
                    background: '#34C759',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 'var(--font-xs)',
                    fontWeight: '600'
                  }}>
                    ✓
                  </div>
                )}
              </div>

              <div>
                <h5 style={{
                  margin: '0 0 2px 0',
                  color: '#e5e7eb',
                  fontSize: 'var(--font-md)',
                  fontWeight: '600',
                  lineHeight: '1.2'
                }}>
                  {theme.name}
                </h5>
                <p style={{
                  margin: '0',
                  color: '#9ca3af',
                  fontSize: 'var(--font-xs)',
                  lineHeight: '1.3'
                }}>
                  {theme.description}
                </p>
                {themeFontFamily && (
                  <p style={{
                    margin: '2px 0 0 0',
                    color: '#6b7280',
                    fontSize: 'var(--font-xs)',
                    fontFamily: themeFontFamily.family,
                    fontStyle: 'italic'
                  }}>
                    {themeFontFamily.name}
                  </p>
                )}
              </div>

              {isSelected && (
                <div style={{
                  position: 'absolute',
                  top: '0',
                  left: '0',
                  right: '0',
                  bottom: '0',
                  background: 'rgba(52, 199, 89, 0.1)',
                  borderRadius: '10px',
                  pointerEvents: 'none'
                }} />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
        <button
          onClick={() => setShowAllThemes(!showAllThemes)}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '8px 24px',
            color: '#e5e7eb',
            fontSize: 'var(--font-sm)',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          {showAllThemes ? 'Show Less Themes' : `Show All Themes (${themes.length})`}
        </button>
      </div>

      <div style={{ marginTop: '32px' }}>
        <h5 style={{
          margin: '0 0 16px 0',
          color: '#e5e7eb',
          fontSize: 'var(--font-lg)',
          fontWeight: '600'
        }}>
          Typography Settings
        </h5>

        <div style={{ marginBottom: '24px' }}>
          <h4 style={{
            margin: '0 0 12px 0',
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Font Size Settings
          </h4>
          <p style={{
            margin: '0 0 20px 0',
            fontSize: 'var(--font-base)',
            color: 'var(--text-secondary)',
            lineHeight: '1.5'
          }}>
            Adjust the text size for better readability across the interface.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px'
          }}>
            {fontSizes.map((fontOption) => (
              <div
                key={fontOption.id}
                onClick={() => onFontSizeChange && onFontSizeChange(fontOption.id)}
                style={{
                  padding: '12px',
                  background: fontSize === fontOption.id
                    ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
                    : 'var(--bg-secondary)',
                  border: fontSize === fontOption.id
                    ? '2px solid rgba(96, 165, 250, 0.6)'
                    : '1px solid var(--border-primary)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: '2px solid',
                    borderColor: fontSize === fontOption.id ? '#60a5fa' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {fontSize === fontOption.id && (
                      <div style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#60a5fa'
                      }} />
                    )}
                  </div>
                  <div>
                    <div style={{
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontSize: 'var(--font-sm)',
                      lineHeight: '1.2'
                    }}>
                      {fontOption.name}
                    </div>
                    <div style={{
                      fontSize: 'var(--font-xs)',
                      color: 'var(--text-secondary)',
                      marginTop: '1px',
                      lineHeight: '1.2'
                    }}>
                      {fontOption.description}
                    </div>
                  </div>
                </div>

                <div style={{
                  border: '1px solid var(--border-primary)',
                  borderRadius: '6px',
                  padding: '8px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)'
                }}>
                  <div style={{
                    fontSize: fontOption.size,
                    lineHeight: '1.3',
                    marginBottom: '2px'
                  }}>
                    Sample ({fontOption.size})
                  </div>
                  <div style={{
                    fontSize: `calc(${fontOption.size} * 0.8)`,
                    color: 'var(--text-secondary)',
                    lineHeight: '1.3'
                  }}>
                    Preview text
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            color: '#9ca3af',
            fontSize: 'var(--font-base)',
            fontWeight: '500'
          }}>
            Font Family
          </label>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px'
          }}>
            {fontFamilies.map((font) => (
              <div
                key={font.id}
                onClick={() => {
                  onFontFamilyChange && onFontFamilyChange(font.id);
                }}
                style={{
                  background: fontFamily === font.id
                    ? 'rgba(52, 199, 89, 0.2)'
                    : 'rgba(255, 255, 255, 0.05)',
                  border: fontFamily === font.id
                    ? '1px solid #34C759'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  pointerEvents: 'auto',
                  userSelect: 'none',
                  zIndex: 1
                }}
                onMouseEnter={(e) => {
                  if (fontFamily !== font.id) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (fontFamily !== font.id) {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  }
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px',
                  pointerEvents: 'none'
                }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: '2px solid',
                    borderColor: fontFamily === font.id ? '#34C759' : 'rgba(255, 255, 255, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {fontFamily === font.id && (
                      <div style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#34C759'
                      }} />
                    )}
                  </div>
                  <div>
                    <div style={{
                      color: fontFamily === font.id ? '#34C759' : '#e5e7eb',
                      fontSize: 'var(--font-sm)',
                      fontWeight: '600',
                      lineHeight: '1.2',
                      fontFamily: font.family
                    }}>
                      {font.name}
                    </div>
                    <div style={{
                      fontSize: 'var(--font-xs)',
                      color: fontFamily === font.id ? '#34C759' : 'rgba(255, 255, 255, 0.6)',
                      marginTop: '1px',
                      lineHeight: '1.2'
                    }}>
                      {font.description}
                    </div>
                  </div>
                </div>

                <div style={{
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '8px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  color: '#e5e7eb',
                  pointerEvents: 'none'
                }}>
                  <div style={{
                    fontSize: 'var(--font-sm)',
                    lineHeight: '1.3',
                    fontFamily: font.family
                  }}>
                    The quick brown fox
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Wallpaper Customization Section - Only show when wallpaper theme is selected */}
      {wallpaperEnabled && (
        <div style={{ marginTop: '32px' }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#e5e7eb',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            🖼️ Wallpaper Customization
          </h3>

          <>
            {/* Curated Wallpaper Gallery */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                color: '#e5e7eb',
                fontWeight: '500',
                marginBottom: '12px',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
                fontSize: 'var(--font-base)'
=======
                fontSize: '14px'
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
              }}>
                Choose a Wallpaper
              </label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '10px',
                marginBottom: '8px'
              }}>
                {curatedWallpapers.map(wallpaper => (
                  <div
                    key={wallpaper.id}
                    onClick={() => onWallpaperUrlChange(wallpaper.url)}
                    style={{
                      position: 'relative',
                      aspectRatio: '16/9',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: wallpaperUrl === wallpaper.url ? '3px solid #34C759' : '2px solid rgba(255, 255, 255, 0.1)',
                      transition: 'all 0.2s ease',
                      backgroundImage: `url(${wallpaper.thumbnail})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                    onMouseEnter={(e) => {
                      if (wallpaperUrl !== wallpaper.url) {
                        e.currentTarget.style.borderColor = 'rgba(52, 199, 89, 0.5)';
                        e.currentTarget.style.transform = 'scale(1.05)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (wallpaperUrl !== wallpaper.url) {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.transform = 'scale(1)';
                      }
                    }}
                  >
                    {wallpaperUrl === wallpaper.url && (
                      <div style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        background: '#34C759',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
                        fontSize: 'var(--font-sm)',
=======
                        fontSize: '12px',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
                        color: '#fff'
                      }}>
                        ✓
                      </div>
                    )}
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
                      padding: '6px 8px',
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
                      fontSize: 'var(--font-xs)',
=======
                      fontSize: '10px',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
                      color: '#fff',
                      fontWeight: '500'
                    }}>
                      {wallpaper.name}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{
<<<<<<< HEAD:src/components/settings/ThemesTab.jsx
                fontSize: 'var(--font-xs)',
=======
                fontSize: '11px',
>>>>>>> master:extension/src/components/settings/ThemesTab.jsx
                color: 'rgba(255, 255, 255, 0.4)',
                marginTop: '6px'
              }}>
                Click any image to set as wallpaper
              </div>
            </div>

            {/* Wallpaper URL Input */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                color: '#e5e7eb',
                fontWeight: '500',
                marginBottom: '8px',
                fontSize: 'var(--font-base)'
              }}>
                Or Use Custom URL (Optional)
              </label>
              <input
                type="url"
                value={wallpaperUrl}
                onChange={(e) => onWallpaperUrlChange(e.target.value)}
                placeholder="https://source.unsplash.com/1920x1080/?nature"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  color: '#e5e7eb',
                  fontSize: 'var(--font-base)',
                  outline: 'none',
                  transition: 'all 0.2s ease'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(52, 199, 89, 0.4)';
                  e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
              />
              <div style={{
                fontSize: 'var(--font-xs)',
                color: 'rgba(255, 255, 255, 0.4)',
                marginTop: '6px'
              }}>
                Try: source.unsplash.com/1920x1080/?nature or your own image URL
              </div>
            </div>

            {/* Intelligent Auto-Change Toggle */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.04)',
                transition: 'all 0.2s',
                color: '#e5e7eb'
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(52, 199, 89, 0.4)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'}
              >
                <input
                  type="checkbox"
                  checked={wallpaperAutoRotate}
                  onChange={(e) => onWallpaperAutoRotateChange(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: '#34C759' }}
                />
                <div>
                  <div style={{ fontWeight: '500', fontSize: 'var(--font-base)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>✨ Intelligent Auto-Change</span>
                  </div>
                  <div style={{ fontSize: 'var(--font-xs)', opacity: 0.6, marginTop: '2px' }}>
                    Discover a new beautiful, curated wallpaper every time you open a new tab.
                  </div>
                </div>
              </label>
            </div>

            {/* Unsplash API Key */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                color: '#e5e7eb',
                fontWeight: '500',
                marginBottom: '8px',
                fontSize: 'var(--font-base)'
              }}>
                Unsplash API Key (Optional)
              </label>
              <input
                type="password"
                value={unsplashApiKey}
                onChange={(e) => onUnsplashApiKeyChange(e.target.value)}
                placeholder="Enter your Unsplash API key"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  color: '#e5e7eb',
                  fontSize: 'var(--font-base)',
                  outline: 'none',
                  transition: 'all 0.2s ease'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(52, 199, 89, 0.4)';
                  e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
              />
              <div style={{
                fontSize: 'var(--font-xs)',
                color: 'rgba(255, 255, 255, 0.4)',
                marginTop: '6px'
              }}>
                Get your free API key at <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>unsplash.com/developers</a>. Enables high-quality wallpaper search.
              </div>
            </div>

            {/* Unsplash Search - Only show if API key is provided */}
            {unsplashApiKey && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  color: '#e5e7eb',
                  fontWeight: '500',
                  marginBottom: '12px',
                  fontSize: 'var(--font-base)'
                }}>
                  Search Unsplash Wallpapers
                </label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input
                    type="text"
                    value={unsplashSearchQuery}
                    onChange={(e) => setUnsplashSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        searchUnsplash(unsplashSearchQuery);
                      }
                    }}
                    placeholder="Search for wallpapers (e.g., mountains, ocean, city)"
                    style={{
                      flex: 1,
                      padding: '12px 14px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: '#e5e7eb',
                      fontSize: 'var(--font-base)',
                      outline: 'none',
                      transition: 'all 0.2s ease'
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = 'rgba(96, 165, 250, 0.4)';
                      e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                    }}
                  />
                  <button
                    onClick={() => searchUnsplash(unsplashSearchQuery)}
                    disabled={unsplashLoading}
                    style={{
                      padding: '12px 20px',
                      background: unsplashLoading ? 'rgba(96, 165, 250, 0.3)' : 'rgba(96, 165, 250, 0.2)',
                      border: '1px solid rgba(96, 165, 250, 0.4)',
                      borderRadius: '10px',
                      color: '#60a5fa',
                      fontSize: 'var(--font-base)',
                      fontWeight: '600',
                      cursor: unsplashLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                      if (!unsplashLoading) {
                        e.currentTarget.style.background = 'rgba(96, 165, 250, 0.3)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!unsplashLoading) {
                        e.currentTarget.style.background = 'rgba(96, 165, 250, 0.2)';
                      }
                    }}
                  >
                    {unsplashLoading ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {/* Error Message */}
                {unsplashError && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '8px',
                    color: '#f87171',
                    fontSize: 'var(--font-sm)',
                    marginBottom: '12px'
                  }}>
                    {unsplashError}
                  </div>
                )}

                {/* Search Results Grid */}
                {unsplashResults.length > 0 && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '10px'
                  }}>
                    {unsplashResults.map(photo => (
                      <div
                        key={photo.id}
                        onClick={() => {
                          onWallpaperUrlChange(photo.urls.full);
                          setUnsplashResults([]);
                          setUnsplashSearchQuery('');
                        }}
                        style={{
                          position: 'relative',
                          aspectRatio: '16/9',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          border: wallpaperUrl === photo.urls.full ? '3px solid #34C759' : '2px solid rgba(255, 255, 255, 0.1)',
                          transition: 'all 0.2s ease',
                          backgroundImage: `url(${photo.urls.small})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }}
                        onMouseEnter={(e) => {
                          if (wallpaperUrl !== photo.urls.full) {
                            e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.5)';
                            e.currentTarget.style.transform = 'scale(1.03)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (wallpaperUrl !== photo.urls.full) {
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.transform = 'scale(1)';
                          }
                        }}
                      >
                        {wallpaperUrl === photo.urls.full && (
                          <div style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: '#34C759',
                            borderRadius: '50%',
                            width: '20px',
                            height: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'var(--font-sm)',
                            color: '#fff'
                          }}>
                            ✓
                          </div>
                        )}
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                          padding: '20px 8px 6px 8px',
                          fontSize: 'var(--font-xs)',
                          color: '#fff'
                        }}>
                          <div style={{ fontWeight: '500', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {photo.alt_description || 'Untitled'}
                          </div>
                          <div style={{ opacity: 0.7, fontSize: '10px' }}>
                            by {photo.user?.name || 'Unknown'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{
                  fontSize: 'var(--font-xs)',
                  color: 'rgba(255, 255, 255, 0.4)',
                  marginTop: '8px'
                }}>
                  Press Enter or click Search to find wallpapers. Click any image to set as wallpaper.
                </div>
              </div>
            )}

            {/* Opacity Slider */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                color: '#e5e7eb',
                fontWeight: '500',
                marginBottom: '8px',
                fontSize: 'var(--font-base)'
              }}>
                Background Opacity: {Math.round(wallpaperOpacity * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={wallpaperOpacity}
                onChange={(e) => onWallpaperOpacityChange(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: `linear-gradient(to right, #34C759 0%, #34C759 ${wallpaperOpacity * 100}%, rgba(255, 255, 255, 0.1) ${wallpaperOpacity * 100}%, rgba(255, 255, 255, 0.1) 100%)`,
                  outline: 'none',
                  WebkitAppearance: 'none',
                  appearance: 'none'
                }}
              />
              <div style={{
                fontSize: 'var(--font-xs)',
                color: 'rgba(255, 255, 255, 0.4)',
                marginTop: '6px'
              }}>
                0% = fully transparent, 100% = fully visible (clearer image)
              </div>
            </div>



            {/* Preview Box */}
            <div style={{
              padding: '16px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <div style={{
                fontSize: 'var(--font-sm)',
                color: 'rgba(255, 255, 255, 0.6)',
                marginBottom: '8px',
                fontWeight: '500'
              }}>
                Preview
              </div>
              <div style={{
                position: 'relative',
                height: '120px',
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#0a0a0f'
              }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundImage: `url(${wallpaperUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  opacity: wallpaperOpacity
                }} />
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backdropFilter: 'blur(8px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 'var(--font-base)',
                  fontWeight: '500'
                }}>
                  Your Dashboard Preview
                </div>
              </div>
            </div>
          </>
        </div>
      )}

      <div style={{
        marginTop: '20px',
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        border: '1px solid var(--border-primary)'
      }}>
        <div style={{
          fontSize: 'var(--font-sm)',
          color: 'var(--text-secondary)',
          lineHeight: '1.5'
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>💡 Tip:</strong> Your theme, typography, and wallpaper preferences are automatically saved and will persist across browser sessions.
        </div>
      </div>
    </div>
  );
};

export default ThemesTab;