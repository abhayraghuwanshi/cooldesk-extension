import { faBackward, faForward, faMusic, faPause, faPlay, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useState } from 'react';

export default function MusicControls() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeApp, setActiveApp] = useState(null);
  const [mediaApps, setMediaApps] = useState([]);

  // Detect app type from URL or title
  const detectAppType = (url, title) => {
    const hostname = url ? new URL(url).hostname.toLowerCase() : '';
    const titleLower = (title || '').toLowerCase();

    if (hostname.includes('spotify') || titleLower.includes('spotify')) {
      return { name: 'Spotify', type: 'music', icon: faMusic, color: '#1DB954' };
    }
    if (hostname.includes('netflix') || titleLower.includes('netflix')) {
      return { name: 'Netflix', type: 'video', icon: faVideo, color: '#E50914' };
    }
    if (hostname.includes('youtube') || titleLower.includes('youtube')) {
      return { name: 'YouTube', type: 'video', icon: faVideo, color: '#FF0000' };
    }
    if (hostname.includes('twitch') || titleLower.includes('twitch')) {
      return { name: 'Twitch', type: 'video', icon: faVideo, color: '#9146FF' };
    }
    if (hostname.includes('soundcloud') || titleLower.includes('soundcloud')) {
      return { name: 'SoundCloud', type: 'music', icon: faMusic, color: '#FF5500' };
    }
    if (hostname.includes('apple') && (hostname.includes('music') || titleLower.includes('apple music'))) {
      return { name: 'Apple Music', type: 'music', icon: faMusic, color: '#FA233B' };
    }
    if (hostname.includes('pandora') || titleLower.includes('pandora')) {
      return { name: 'Pandora', type: 'music', icon: faMusic, color: '#005483' };
    }
    if (hostname.includes('tidal') || titleLower.includes('tidal')) {
      return { name: 'Tidal', type: 'music', icon: faMusic, color: '#000000' };
    }
    if (hostname.includes('deezer') || titleLower.includes('deezer')) {
      return { name: 'Deezer', type: 'music', icon: faMusic, color: '#FF8000' };
    }
    if (hostname.includes('hulu') || titleLower.includes('hulu')) {
      return { name: 'Hulu', type: 'video', icon: faVideo, color: '#1CE783' };
    }
    if (hostname.includes('disney') || titleLower.includes('disney')) {
      return { name: 'Disney+', type: 'video', icon: faVideo, color: '#113CCF' };
    }
    if (hostname.includes('amazon') && (hostname.includes('prime') || titleLower.includes('prime video'))) {
      return { name: 'Prime Video', type: 'video', icon: faVideo, color: '#00A8E1' };
    }

    // Generic fallback
    return { name: 'Media Player', type: 'unknown', icon: faPlay, color: 'var(--accent-primary, #34C759)' };
  };

  // Direct media command function - bypasses background script
  const sendMediaCommand = async (action, targetTabId = null) => {
    try {
      console.log(`[MusicControls] Sending direct ${action} command to tab:`, targetTabId);

      if (!targetTabId) {
        console.warn('No target tab ID provided');
        return;
      }

      // Send command directly to the target tab
      if (chrome?.scripting?.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: (action) => {
            console.log(`[Content] Executing ${action} command`);

            // Try Media Session API first
            if ('mediaSession' in navigator && navigator.mediaSession) {
              try {
                if (action === 'play') {
                  navigator.mediaSession.playbackState = 'playing';
                } else if (action === 'pause') {
                  navigator.mediaSession.playbackState = 'paused';
                }
              } catch (e) {
                console.log('[Content] Media session API failed:', e);
              }
            }

            // DOM manipulation fallback for specific services
            try {
              if (action === 'play' || action === 'pause') {
                // YouTube selectors
                let playBtn = document.querySelector('.ytp-play-button');

                // Netflix selectors
                if (!playBtn) playBtn = document.querySelector('[data-uia="control-play-pause-toggle"], .PlayerControlsNeo__button--play-pause, button[aria-label*="Play"], button[aria-label*="Pause"]');

                // Spotify selectors
                if (!playBtn) playBtn = document.querySelector('[data-testid="control-button-playpause"]');

                // YouTube Music selectors
                if (!playBtn) playBtn = document.querySelector('#play-pause-button, .play-pause-button');

                // Generic selectors
                if (!playBtn) playBtn = document.querySelector('[aria-label*="Play"], [aria-label*="Pause"], .playButton, .pauseButton');

                if (playBtn) {
                  playBtn.click();
                  console.log('[Content] Clicked play/pause button');
                  return { success: true, service: 'DOM' };
                } else {
                  console.log('[Content] No play/pause button found');
                }
              } else if (action === 'nexttrack') {
                // YouTube next video
                let nextBtn = document.querySelector('.ytp-next-button');

                // Spotify next track
                if (!nextBtn) nextBtn = document.querySelector('[data-testid="control-button-skip-forward"]');

                // Generic selectors
                if (!nextBtn) nextBtn = document.querySelector('.next-button, [aria-label*="Next"]');

                if (nextBtn) {
                  nextBtn.click();
                  console.log('[Content] Clicked next button');
                  return { success: true, service: 'DOM' };
                }
              } else if (action === 'previoustrack') {
                // YouTube previous video
                let prevBtn = document.querySelector('.ytp-prev-button');

                // Spotify previous track
                if (!prevBtn) prevBtn = document.querySelector('[data-testid="control-button-skip-back"]');

                // Generic selectors
                if (!prevBtn) prevBtn = document.querySelector('.previous-button, [aria-label*="Previous"]');

                if (prevBtn) {
                  prevBtn.click();
                  console.log('[Content] Clicked previous button');
                  return { success: true, service: 'DOM' };
                }
              }
            } catch (e) {
              console.log('[Content] DOM control failed:', e);
            }

            return { success: false };
          },
          args: [action]
        });
        console.log(`[MusicControls] Command sent successfully to tab ${targetTabId}`);
      }
    } catch (e) {
      console.warn('Direct media control failed:', e);
    }
  };

  // Find and control active media tabs
  const findMediaTabs = async () => {
    try {
      if (chrome?.tabs?.query) {
        const tabs = await chrome.tabs.query({ audible: true });
        const mediaTabs = tabs.map(tab => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          app: detectAppType(tab.url, tab.title)
        }));

        // Also check for any paused media tabs that might not be audible
        const allTabs = await chrome.tabs.query({});
        const potentialMediaTabs = allTabs.filter(tab => {
          const hostname = tab.url ? new URL(tab.url).hostname.toLowerCase() : '';
          return hostname.includes('spotify') || hostname.includes('netflix') ||
            hostname.includes('youtube') || hostname.includes('twitch') ||
            hostname.includes('soundcloud') || hostname.includes('apple') ||
            hostname.includes('pandora') || hostname.includes('tidal') ||
            hostname.includes('deezer') || hostname.includes('hulu') ||
            hostname.includes('disney') || hostname.includes('amazon');
        });

        const allMediaTabs = [...mediaTabs];
        potentialMediaTabs.forEach(tab => {
          if (!mediaTabs.find(mt => mt.id === tab.id)) {
            allMediaTabs.push({
              id: tab.id,
              url: tab.url,
              title: tab.title,
              app: detectAppType(tab.url, tab.title)
            });
          }
        });

        // Only update state if the tabs have actually changed
        const currentIds = mediaApps.map(app => app.id).sort();
        const newIds = allMediaTabs.map(app => app.id).sort();
        if (JSON.stringify(currentIds) !== JSON.stringify(newIds)) {
          setMediaApps(allMediaTabs);

          // Set active app to the first playing media if none selected
          if (allMediaTabs.length > 0 && !activeApp) {
            setActiveApp(allMediaTabs[0]);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to query media tabs:', e);
    }
  };

  // Get current media state from the active tab
  const checkMediaState = async () => {
    if (!activeApp?.id) return;

    try {
      if (chrome?.tabs?.get) {
        const tab = await chrome.tabs.get(activeApp.id);
        if (tab) {
          // For video sites like Netflix, YouTube, check if tab is audible
          // For music sites, might need different logic
          setIsPlaying(tab.audible);
        }
      }
    } catch (e) {
      console.warn('Could not check media state:', e);
      setIsPlaying(false);
    }
  };

  const handlePlayPause = async () => {
    if (!activeApp?.id) return;

    const action = isPlaying ? 'pause' : 'play';

    try {
      // Always send command to the selected app in dropdown
      await sendMediaCommand(action, activeApp.id);
      // Check state after command
      setTimeout(() => checkMediaState(), 300);
    } catch (e) {
      console.warn('Play/pause command failed:', e);
    }
  };

  const handlePrevious = () => {
    const targetTabId = activeApp?.id;
    sendMediaCommand('previoustrack', targetTabId);
  };

  const handleNext = () => {
    const targetTabId = activeApp?.id;
    sendMediaCommand('nexttrack', targetTabId);
  };

  const handleAppSwitch = (app) => {
    setActiveApp(app);
    // Check state of the new app immediately
    setTimeout(() => checkMediaState(), 100);
  };

  // Listen for tab audio state changes
  useEffect(() => {
    const messageListener = (message) => {
      if (message.type === 'TAB_AUDIO_STATE_CHANGED') {
        if (message.tabId === activeApp?.id) {
          setIsPlaying(message.audible);
        }
      }
    };

    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }
  }, [activeApp?.id]);

  // Periodically check for media tabs and state
  useEffect(() => {
    findMediaTabs();
    const interval = setInterval(() => {
      findMediaTabs();
      checkMediaState();
    }, 2000); // Check every 2 seconds
    return () => clearInterval(interval);
  }, [activeApp?.id]);

  // Check media state when active app changes
  useEffect(() => {
    if (activeApp?.id) {
      checkMediaState();
    }
  }, [activeApp?.id]);

  // Don't render if no media apps are detected
  if (mediaApps.length === 0) {
    return null;
  }

  return (
    <div className="music-controls" style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: '8px' }}>
      {/* App selector dropdown */}
      {mediaApps.length > 1 && (
        <select
          value={activeApp?.id || ''}
          onChange={(e) => {
            const selectedApp = mediaApps.find(app => app.id === parseInt(e.target.value));
            if (selectedApp) handleAppSwitch(selectedApp);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: '10px',
            fontWeight: '500',
            color: 'var(--text-primary, #ffffff)',
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.05))',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
            borderRadius: '6px',
            padding: '4px 6px',
            minWidth: '80px',
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
            cursor: 'pointer',
            outline: 'none',
            marginRight: '4px'
          }}
          title={`Active: ${activeApp?.app?.name || 'No media'}`}
        >
          {mediaApps.map((app) => (
            <option
              key={app.id}
              value={app.id}
              style={{
                background: 'var(--background-primary, rgba(10, 10, 15, 0.95))',
                color: 'var(--text-primary, #ffffff)',
                fontSize: '10px'
              }}
            >
              {app.app.name}
            </option>
          ))}
        </select>
      )}

      {/* Show app indicator if only one app */}
      {mediaApps.length === 1 && activeApp && (
        <div
          style={{
            fontSize: '10px',
            fontWeight: '500',
            color: 'var(--text-primary, #ffffff)',
            background: activeApp.app.color,
            borderRadius: '6px',
            padding: '4px 6px',
            minWidth: '60px',
            textAlign: 'center',
            marginRight: '4px',
            opacity: 0.8
          }}
          title={`Playing on ${activeApp.app.name}`}
        >
          <FontAwesomeIcon icon={activeApp.app.icon} style={{ marginRight: '2px', fontSize: '8px' }} />
          {activeApp.app.name}
        </div>
      )}

      <button
        className="icon-btn music-btn"
        onClick={handlePrevious}
        title={`Previous Track${activeApp ? ` (${activeApp.app.name})` : ''}`}
        disabled={!activeApp}
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
          color: activeApp ? 'var(--text, #e5e7eb)' : 'var(--text-muted, #6b7280)',
          opacity: activeApp ? 1 : 0.5,
          cursor: activeApp ? 'pointer' : 'not-allowed'
        }}
      >
        <FontAwesomeIcon icon={faBackward} />
      </button>

      <button
        className="icon-btn music-btn"
        onClick={handlePlayPause}
        title={`${isPlaying ? "Pause" : "Play"}${activeApp ? ` (${activeApp.app.name})` : ''}`}
        disabled={!activeApp}
        style={{
          background: isPlaying && activeApp
            ? `linear-gradient(135deg, ${activeApp.app.color}, var(--accent-secondary, #30D158))`
            : 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          borderColor: isPlaying && activeApp ? activeApp.app.color : 'var(--border-primary, rgba(255, 255, 255, 0.1))',
          color: isPlaying && activeApp ? 'white' : (activeApp ? 'var(--text, #e5e7eb)' : 'var(--text-muted, #6b7280)'),
          opacity: activeApp ? 1 : 0.5,
          cursor: activeApp ? 'pointer' : 'not-allowed'
        }}
      >
        <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
      </button>

      <button
        className="icon-btn music-btn"
        onClick={handleNext}
        title={`Next Track${activeApp ? ` (${activeApp.app.name})` : ''}`}
        disabled={!activeApp}
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.1))',
          borderColor: 'var(--border-primary, rgba(255, 255, 255, 0.1))',
          color: activeApp ? 'var(--text, #e5e7eb)' : 'var(--text-muted, #6b7280)',
          opacity: activeApp ? 1 : 0.5,
          cursor: activeApp ? 'pointer' : 'not-allowed'
        }}
      >
        <FontAwesomeIcon icon={faForward} />
      </button>
    </div>
  );
}