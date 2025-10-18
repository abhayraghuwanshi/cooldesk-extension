import {
  faBook,
  faKeyboard,
  faLightbulb,
  faRocket,
  faTimes,
  faVideo
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { createPortal } from 'react-dom';

export function CoolHelpSection({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('shortcuts');

  if (!isOpen) return null;

  const shortcuts = [
    { keys: ['Shift Shift'], action: 'Open Almighty Search' },
    { keys: ['Ctrl/Cmd K'], action: 'Quick Search' },
    { keys: ['Ctrl/Cmd N'], action: 'New Workspace' },
    { keys: ['Esc'], action: 'Close Dialog' },
  ];

  const features = [
    {
      icon: faRocket,
      title: 'Workspaces',
      desc: 'Organize tabs and links by project',
    },
    {
      icon: faBook,
      title: 'AI Chats',
      desc: 'Auto-save ChatGPT, Claude, Gemini & Grok',
    },
    {
      icon: faKeyboard,
      title: 'Voice Control',
      desc: 'Navigate with voice commands',
    },
    {
      icon: faLightbulb,
      title: 'Smart Search',
      desc: 'Search everything instantly',
    },
  ];

  const tips = [
    'Double-tap Shift for quick search',
    'Say "show numbers" to click anything',
    'Right-click workspaces to pin or delete',
    'AI chats are auto-saved',
    'Use split-screen for multitasking',
  ];

  const modal = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(12px)',
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--glass-bg, rgba(15, 21, 34, 0.95))',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          width: '90vw',
          maxWidth: '700px',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          margin: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <FontAwesomeIcon
              icon={faBook}
              style={{ fontSize: '24px', color: '#7c3aed' }}
            />
            <h2
              style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.95)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                letterSpacing: '-0.5px',
              }}
            >
              CoolDesk Help
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
              color: 'rgba(255, 255, 255, 0.7)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.95)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
            }}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {[
            { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: faKeyboard },
            { id: 'features', label: 'Features', icon: faRocket },
            { id: 'tips', label: 'Tips & Tricks', icon: faLightbulb },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background:
                  activeTab === tab.id
                    ? 'rgba(124, 58, 237, 0.15)'
                    : 'rgba(255, 255, 255, 0.03)',
                border:
                  activeTab === tab.id
                    ? '1px solid rgba(124, 58, 237, 0.3)'
                    : '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '10px',
                padding: '10px 16px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                color:
                  activeTab === tab.id
                    ? 'rgba(255, 255, 255, 0.95)'
                    : 'rgba(255, 255, 255, 0.6)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                fontSize: '14px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                }
              }}
            >
              <FontAwesomeIcon icon={tab.icon} style={{ fontSize: '14px' }} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '28px',
          }}
        >
          {activeTab === 'shortcuts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {shortcuts.map((shortcut, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '14px',
                    padding: '20px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  }}
                >
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 500,
                      color: 'rgba(255, 255, 255, 0.95)',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                      letterSpacing: '-0.2px',
                    }}
                  >
                    {shortcut.action}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {shortcut.keys.map((key, keyIdx) => (
                      <span
                        key={keyIdx}
                        style={{
                          background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(124, 58, 237, 0.1))',
                          border: '1px solid rgba(124, 58, 237, 0.3)',
                          borderRadius: '8px',
                          padding: '8px 16px',
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.95)',
                          fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 2px 8px rgba(124, 58, 237, 0.15)',
                        }}
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'features' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {features.map((feature, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '16px',
                    padding: '28px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    transition: 'all 0.2s',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <FontAwesomeIcon
                    icon={feature.icon}
                    style={{
                      fontSize: '32px',
                      color: '#7c3aed',
                      filter: 'drop-shadow(0 0 12px rgba(124, 58, 237, 0.4))',
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.95)',
                        marginBottom: '8px',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                        letterSpacing: '-0.4px',
                      }}
                    >
                      {feature.title}
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        color: 'rgba(255, 255, 255, 0.65)',
                        lineHeight: '1.6',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                      }}
                    >
                      {feature.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tips' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {tips.map((tip, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '14px',
                    padding: '20px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  }}
                >
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.3), rgba(124, 58, 237, 0.15))',
                      border: '1px solid rgba(124, 58, 237, 0.4)',
                      borderRadius: '50%',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'rgba(255, 255, 255, 0.95)',
                      boxShadow: '0 2px 8px rgba(124, 58, 237, 0.2)',
                    }}
                  >
                    {idx + 1}
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      color: 'rgba(255, 255, 255, 0.85)',
                      lineHeight: '1.6',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                      fontWeight: 500,
                    }}
                  >
                    {tip}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
