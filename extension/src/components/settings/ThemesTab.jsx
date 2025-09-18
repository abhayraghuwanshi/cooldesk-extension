import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

const ThemesTab = ({
  selectedTheme,
  fontSize,
  fontFamily,
  onThemeChange,
  onFontSizeChange,
  onFontFamilyChange
}) => {
  // Theme options with font family pairings
  const themes = [
    {
      id: 'ai-midnight-nebula',
      name: 'AI Midnight Nebula',
      description: 'Deep space theme with blue and purple nebula effects',
      preview: 'radial-gradient(60% 80% at 10% 10%, #60a5fa1f, #0000 60%), radial-gradient(50% 60% at 90% 20%, #8b5cf61f, #0000 60%), linear-gradient(180deg, #0a0a0f 0%, #121218 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'cosmic-aurora',
      name: 'Cosmic Aurora',
      description: 'Northern lights inspired with green and teal gradients',
      preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #06b6d420, #0000 60%), linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'sunset-horizon',
      name: 'Sunset Horizon',
      description: 'Warm sunset colors with orange and pink tones',
      preview: 'radial-gradient(60% 80% at 10% 70%, #f9731620, #0000 60%), radial-gradient(50% 60% at 90% 30%, #ec489920, #0000 60%), linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'forest-depths',
      name: 'Forest Depths',
      description: 'Deep forest theme with emerald and jade accents',
      preview: 'radial-gradient(60% 80% at 30% 20%, #059f4620, #0000 60%), radial-gradient(50% 60% at 70% 80%, #047c3a20, #0000 60%), linear-gradient(180deg, #0f1419 0%, #1a2332 100%)',
      fontFamily: 'system'
    },
    {
      id: 'minimal-dark',
      name: 'Minimal Dark',
      description: 'Clean minimal dark theme with subtle gradients',
      preview: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'ocean-depths',
      name: 'Ocean Depths',
      description: 'Deep mystical waters with purple and indigo depths',
      preview: 'radial-gradient(50% 60% at 20% 30%, #8b5cf620, #0000 70%), radial-gradient(40% 50% at 80% 20%, #a78bfa20, #0000 60%), linear-gradient(140deg, #1a0c26 0%, #3b1e29 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'cherry-blossom',
      name: 'Cherry Blossom',
      description: 'Soft pink and purple spring theme',
      preview: 'radial-gradient(60% 70% at 25% 25%, #ec489920, #0000 65%), radial-gradient(50% 60% at 75% 15%, #a855f720, #0000 70%), linear-gradient(130deg, #1f1729 0%, #2d1b3d 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'arctic-frost',
      name: 'Arctic Frost',
      description: 'Cool arctic with teal and mint ice accents',
      preview: 'radial-gradient(40% 50% at 30% 20%, #14b8a615, #0000 70%), radial-gradient(60% 40% at 70% 80%, #5eead415, #0000 60%), linear-gradient(155deg, #0f1b1a 0%, #2d4a42 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'volcanic-ember',
      name: 'Volcanic Ember',
      description: 'Fiery volcanic theme with red and orange embers',
      preview: 'radial-gradient(60% 80% at 30% 20%, #dc262620, #0000 60%), radial-gradient(50% 60% at 80% 40%, #ea580c20, #0000 60%), linear-gradient(140deg, #1a0f0f 0%, #2d1b1b 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'neon-cyberpunk',
      name: 'Neon Cyberpunk',
      description: 'Futuristic cyberpunk with neon pink and cyan',
      preview: 'radial-gradient(60% 50% at 30% 20%, #ec489920, #0000 65%), radial-gradient(40% 60% at 70% 80%, #06b6d420, #0000 70%), linear-gradient(135deg, #0a0a0f 0%, #2a1a2a 100%)',
      fontFamily: 'jetbrains'
    },
    {
      id: 'white-cred',
      name: 'White Credential',
      description: 'Clean white theme with subtle accents',
      preview: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
      fontFamily: 'system'
    },
    {
      id: 'orange-warm',
      name: 'Orange Warm',
      description: 'Warm orange theme with cozy earth tones',
      preview: 'radial-gradient(60% 80% at 20% 30%, #f9731620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #ea580c20, #0000 60%), linear-gradient(180deg, #2d1b1b 0%, #451a03 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'brown-earth',
      name: 'Brown Earth',
      description: 'Earthy brown theme with natural tones',
      preview: 'radial-gradient(60% 80% at 20% 30%, #92400e20, #0000 60%), radial-gradient(50% 60% at 80% 10%, #78350f20, #0000 60%), linear-gradient(180deg, #3c2415 0%, #451a03 100%)',
      fontFamily: 'system'
    },
    {
      id: 'royal-purple',
      name: 'Royal Purple',
      description: 'Elegant purple and lavender with gold accents',
      preview: 'radial-gradient(60% 80% at 20% 30%, #8b5cf620, #0000 60%), radial-gradient(50% 60% at 80% 10%, #a855f720, #0000 60%), linear-gradient(180deg, #1e1b3a 0%, #2d1b69 100%)',
      fontFamily: 'poppins'
    },
    {
      id: 'golden-honey',
      name: 'Golden Honey',
      description: 'Warm golden yellows with amber and bronze accents',
      preview: 'radial-gradient(60% 80% at 20% 30%, #f59e0b20, #0000 60%), radial-gradient(50% 60% at 80% 10%, #d9770620, #0000 60%), linear-gradient(180deg, #3a2817 0%, #451a03 100%)',
      fontFamily: 'roboto'
    },
    {
      id: 'mint-sage',
      name: 'Mint Sage',
      description: 'Fresh mint and sage greens with earthy undertones',
      preview: 'radial-gradient(60% 80% at 20% 30%, #10b98120, #0000 60%), radial-gradient(50% 60% at 80% 10%, #6ee7b720, #0000 60%), linear-gradient(180deg, #1e2e23 0%, #0f2027 100%)',
      fontFamily: 'inter'
    },
    {
      id: 'crimson-fire',
      name: 'Crimson Fire',
      description: 'Bold red with deep crimson and rose gold accents',
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

  // Font family options
  const fontFamilies = [
    { id: 'system', name: 'System Default', family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif', description: 'Native system fonts' },
    { id: 'inter', name: 'Inter', family: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Modern geometric sans-serif' },
    { id: 'roboto', name: 'Roboto', family: 'Roboto, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Google\'s friendly sans-serif' },
    { id: 'poppins', name: 'Poppins', family: 'Poppins, -apple-system, BlinkMacSystemFont, sans-serif', description: 'Rounded geometric typeface' },
    { id: 'jetbrains', name: 'JetBrains Mono', family: 'JetBrains Mono, Consolas, Monaco, monospace', description: 'Developer-focused monospace' }
  ];

  return (
    <div style={{ padding: '16px 0' }}>
      <h4 style={{
        margin: '0 0 16px 0',
        color: '#e5e7eb',
        fontSize: '18px',
        fontWeight: '600'
      }}>
        Choose Your Theme
      </h4>
      <p style={{
        margin: '0 0 24px 0',
        color: '#9ca3af',
        fontSize: '14px',
        lineHeight: '1.5'
      }}>
        Select a theme that matches your style. Each theme includes a carefully chosen font family. Changes apply instantly.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px'
      }}>
        {themes.map((theme) => {
          const themeFontFamily = fontFamilies.find(f => f.id === theme.fontFamily);
          return (
            <div
              key={theme.id}
              onClick={() => {
                onThemeChange(theme.id);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: selectedTheme === theme.id
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
              if (selectedTheme !== theme.id) {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              if (selectedTheme !== theme.id) {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            <div style={{
              width: '100%',
              height: '50px',
              background: theme.preview,
              borderRadius: '8px',
              marginBottom: '8px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {selectedTheme === theme.id && (
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
                  fontSize: '10px',
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
                fontSize: '13px',
                fontWeight: '600',
                lineHeight: '1.2'
              }}>
                {theme.name}
              </h5>
              <p style={{
                margin: '0',
                color: '#9ca3af',
                fontSize: '11px',
                lineHeight: '1.3'
              }}>
                {theme.description}
              </p>
              {themeFontFamily && (
                <p style={{
                  margin: '2px 0 0 0',
                  color: '#6b7280',
                  fontSize: '9px',
                  fontFamily: themeFontFamily.family,
                  fontStyle: 'italic'
                }}>
                  {themeFontFamily.name}
                </p>
              )}
            </div>

            {selectedTheme === theme.id && (
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

      <div style={{ marginTop: '32px' }}>
        <h5 style={{
          margin: '0 0 16px 0',
          color: '#e5e7eb',
          fontSize: '16px',
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
            fontSize: '14px',
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
                      fontSize: '12px',
                      lineHeight: '1.2'
                    }}>
                      {fontOption.name}
                    </div>
                    <div style={{
                      fontSize: '10px',
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
            fontSize: '14px',
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
                      fontSize: '12px',
                      fontWeight: '600',
                      lineHeight: '1.2',
                      fontFamily: font.family
                    }}>
                      {font.name}
                    </div>
                    <div style={{
                      fontSize: '10px',
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
                    fontSize: '12px',
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

      <div style={{
        marginTop: '20px',
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        border: '1px solid var(--border-primary)'
      }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          lineHeight: '1.5'
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>💡 Tip:</strong> Your theme and typography preferences are automatically saved and will persist across browser sessions.
        </div>
      </div>
    </div>
  );
};

export default ThemesTab;