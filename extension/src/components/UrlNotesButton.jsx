import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStickyNote, faTimes } from '@fortawesome/free-solid-svg-icons';
import { UrlNotesSection } from './UrlNotesSection';

export function UrlNotesButton() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentUrl, setCurrentUrl] = React.useState('');
  const [notesCount, setNotesCount] = React.useState(0);

  // Get current tab URL
  const getCurrentUrl = React.useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        setCurrentUrl(tab.url);
        
        // Get notes count for this URL
        const { getUrlNotes } = await import('../db');
        const notes = await getUrlNotes(tab.url);
        setNotesCount(notes.length);
      }
    } catch (error) {
      console.error('Failed to get current URL:', error);
    }
  }, []);

  React.useEffect(() => {
    getCurrentUrl();
    
    // Update URL when tab changes
    const handleTabUpdate = () => {
      setTimeout(getCurrentUrl, 100); // Small delay to ensure tab is updated
    };

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.onActivated.addListener(handleTabUpdate);
      chrome.tabs.onUpdated.addListener(handleTabUpdate);
      
      return () => {
        chrome.tabs.onActivated.removeListener(handleTabUpdate);
        chrome.tabs.onUpdated.removeListener(handleTabUpdate);
      };
    }
  }, [getCurrentUrl]);

  if (!currentUrl) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: notesCount > 0 ? '#10b981' : '#3b82f6',
          border: 'none',
          color: 'white',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          transition: 'all 0.2s ease'
        }}
        title={`${notesCount > 0 ? `${notesCount} notes for` : 'Add notes to'} this page`}
        onMouseEnter={(e) => {
          e.target.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'scale(1)';
        }}
      >
        <FontAwesomeIcon icon={faStickyNote} />
        {notesCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -2,
            right: -2,
            background: '#dc2626',
            color: 'white',
            borderRadius: '50%',
            width: 20,
            height: 20,
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold'
          }}>
            {notesCount > 99 ? '99+' : notesCount}
          </span>
        )}
      </button>

      {/* Notes panel */}
      {isOpen && (
        <UrlNotesSection 
          url={currentUrl} 
          onClose={() => {
            setIsOpen(false);
            getCurrentUrl(); // Refresh count when closing
          }} 
        />
      )}
    </>
  );
}
