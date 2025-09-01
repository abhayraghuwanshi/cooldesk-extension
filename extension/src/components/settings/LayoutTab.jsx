import React from 'react';

const LayoutTab = ({ useVerticalLayout, onLayoutToggle }) => {
  const handleLayoutChange = (isVertical) => {
    if (onLayoutToggle) {
      onLayoutToggle(isVertical);
      // Also save to localStorage as backup
      try {
        localStorage.setItem('cooldesk-vertical-layout', isVertical.toString());
      } catch (e) {
        console.warn('Failed to save layout preference to localStorage:', e);
      }
    }
  };

  return (
    <div style={{ padding: '16px 0' }}>
      <h4 style={{
        margin: '0 0 12px 0',
        fontSize: '16px',
        fontWeight: '600',
        color: 'var(--text-primary)'
      }}>
        Interface Layout
      </h4>
      <p style={{
        margin: '0 0 20px 0',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: '1.5'
      }}>
        Choose between horizontal header or vertical sidebar layout for the navigation interface.
      </p>

      <div style={{ display: 'grid', gap: '16px' }}>
        {/* Horizontal Layout Option */}
        <div
          onClick={() => handleLayoutChange(false)}
          style={{
            padding: '16px',
            background: !useVerticalLayout
              ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
              : 'var(--bg-secondary)',
            border: !useVerticalLayout
              ? '2px solid rgba(96, 165, 250, 0.6)'
              : '1px solid var(--border-primary)',
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              border: '2px solid',
              borderColor: !useVerticalLayout ? '#60a5fa' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {!useVerticalLayout && (
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#60a5fa'
                }} />
              )}
            </div>
            <div>
              <div style={{
                fontWeight: '600',
                color: 'var(--text-primary)',
                fontSize: '14px'
              }}>
                Horizontal Header
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '2px'
              }}>
                Traditional header across the top
              </div>
            </div>
          </div>

          {/* Layout Preview */}
          <div style={{
            border: '1px solid var(--border-primary)',
            borderRadius: '6px',
            padding: '8px',
            background: 'var(--bg-tertiary)',
            fontSize: '10px',
            color: 'var(--text-secondary)'
          }}>
            <div style={{
              height: '12px',
              background: 'var(--border-primary)',
              borderRadius: '2px',
              marginBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '4px'
            }}>
              Header
            </div>
            <div style={{ height: '24px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
              Content Area
            </div>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            ✓ More vertical space for content<br />
            ✓ Familiar traditional layout<br />
            ✓ Better for wide content
          </div>
        </div>

        {/* Vertical Layout Option */}
        <div
          onClick={() => handleLayoutChange(true)}
          style={{
            padding: '16px',
            background: useVerticalLayout
              ? 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)'
              : 'var(--bg-secondary)',
            border: useVerticalLayout
              ? '2px solid rgba(96, 165, 250, 0.6)'
              : '1px solid var(--border-primary)',
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              border: '2px solid',
              borderColor: useVerticalLayout ? '#60a5fa' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {useVerticalLayout && (
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#60a5fa'
                }} />
              )}
            </div>
            <div>
              <div style={{
                fontWeight: '600',
                color: 'var(--text-primary)',
                fontSize: '14px'
              }}>
                Vertical Sidebar
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '2px'
              }}>
                Modern sidebar on the right
              </div>
            </div>
          </div>

          {/* Layout Preview */}
          <div style={{
            border: '1px solid var(--border-primary)',
            borderRadius: '6px',
            padding: '8px',
            background: 'var(--bg-tertiary)',
            fontSize: '10px',
            color: 'var(--text-secondary)',
            display: 'flex',
            gap: '4px'
          }}>
            <div style={{
              flex: 1,
              height: '36px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '4px'
            }}>
              Content Area
            </div>
            <div style={{
              width: '20px',
              background: 'var(--border-primary)',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              writingMode: 'vertical-rl',
              fontSize: '8px'
            }}>
              Sidebar
            </div>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            ✓ More horizontal reading space<br />
            ✓ Modern app-style interface<br />
            ✓ Collapsible to icon-only mode
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
          <strong style={{ color: 'var(--text-primary)' }}>💡 Tip:</strong> You can switch between layouts anytime.
          The vertical sidebar is great for content-heavy workflows, while the horizontal header maximizes vertical space.
        </div>
      </div>
    </div>
  );
};

export default LayoutTab;