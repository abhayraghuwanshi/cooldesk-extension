import { faBackward, faForward, faMusic, faPause, faPlay, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useCallback, useEffect, useState } from 'react';

export default function MusicControls() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeApp, setActiveApp] = useState(null);
  const [mediaApps, setMediaApps] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hasMediaTarget, setHasMediaTarget] = useState(false);

  const map = [
    // 🎵 Music Streaming
    { key: 'spotify', name: 'Spotify', type: 'music', icon: faMusic, color: '#1DB954' },
    { key: 'youtube', name: 'YouTube', type: 'video', icon: faVideo, color: '#FF0000' },
    { key: 'music.youtube', name: 'YouTube Music', type: 'music', icon: faMusic, color: '#FF0000' },
    { key: 'soundcloud', name: 'SoundCloud', type: 'music', icon: faMusic, color: '#FF5500' },
    { key: 'apple', name: 'Apple Music', type: 'music', icon: faMusic, color: '#FA233B' },
    { key: 'pandora', name: 'Pandora', type: 'music', icon: faMusic, color: '#005483' },
    { key: 'deezer', name: 'Deezer', type: 'music', icon: faMusic, color: '#FF8000' },
    { key: 'tidal', name: 'Tidal', type: 'music', icon: faMusic, color: '#000000' },
    { key: 'amazonmusic', name: 'Amazon Music', type: 'music', icon: faMusic, color: '#00A8E1' },
    { key: 'gaana', name: 'Gaana', type: 'music', icon: faMusic, color: '#E72C30' },
    { key: 'wynk', name: 'Wynk Music', type: 'music', icon: faMusic, color: '#D82D3F' },
    { key: 'jiosaavn', name: 'JioSaavn', type: 'music', icon: faMusic, color: '#00BFA5' },
    { key: 'napster', name: 'Napster', type: 'music', icon: faMusic, color: '#0073E6' },
    { key: 'mixcloud', name: 'Mixcloud', type: 'music', icon: faMusic, color: '#5000FF' },
    { key: 'bandcamp', name: 'Bandcamp', type: 'music', icon: faMusic, color: '#629AA9' },
    { key: 'audiomack', name: 'Audiomack', type: 'music', icon: faMusic, color: '#FFA200' },
    { key: 'boomplay', name: 'Boomplay', type: 'music', icon: faMusic, color: '#03A9F4' },
    { key: 'reverbnation', name: 'ReverbNation', type: 'music', icon: faMusic, color: '#E2001A' },
    { key: '8tracks', name: '8tracks', type: 'music', icon: faMusic, color: '#12223A' },
    { key: 'last.fm', name: 'Last.fm', type: 'music', icon: faMusic, color: '#D51007' },
    { key: 'iheartradio', name: 'iHeartRadio', type: 'music', icon: faMusic, color: '#C6002B' },
    { key: 'radio.garden', name: 'Radio Garden', type: 'music', icon: faMusic, color: '#00BFA5' },
    { key: 'sound.xyz', name: 'Sound.xyz', type: 'music', icon: faMusic, color: '#FFD54F' },
    { key: 'anghami', name: 'Anghami', type: 'music', icon: faMusic, color: '#9146FF' },
    { key: 'kkbox', name: 'KKBox', type: 'music', icon: faMusic, color: '#00B2E2' },
    { key: 'melon', name: 'Melon', type: 'music', icon: faMusic, color: '#00CD3C' },
    { key: 'bugs', name: 'Bugs Music', type: 'music', icon: faMusic, color: '#FF6B00' },

    // 🎬 Video Platforms
    { key: 'netflix', name: 'Netflix', type: 'video', icon: faVideo, color: '#E50914' },
    { key: 'primevideo', name: 'Prime Video', type: 'video', icon: faVideo, color: '#00A8E1' },
    { key: 'disneyplus', name: 'Disney+', type: 'video', icon: faVideo, color: '#113CCF' },
    { key: 'hotstar', name: 'Hotstar', type: 'video', icon: faVideo, color: '#0C2233' },
    { key: 'hulu', name: 'Hulu', type: 'video', icon: faVideo, color: '#1CE783' },
    { key: 'twitch', name: 'Twitch', type: 'video', icon: faVideo, color: '#9146FF' },
    { key: 'crunchyroll', name: 'Crunchyroll', type: 'video', icon: faVideo, color: '#F47521' },
    { key: 'funimation', name: 'Funimation', type: 'video', icon: faVideo, color: '#4500FF' },
    { key: 'peacocktv', name: 'Peacock', type: 'video', icon: faVideo, color: '#FFC107' },
    { key: 'paramountplus', name: 'Paramount+', type: 'video', icon: faVideo, color: '#0064FF' },
    { key: 'hbomax', name: 'HBO Max', type: 'video', icon: faVideo, color: '#6E00FF' },
    { key: 'starz', name: 'Starz', type: 'video', icon: faVideo, color: '#000000' },
    { key: 'showtime', name: 'Showtime', type: 'video', icon: faVideo, color: '#CC0000' },
    { key: 'vimeo', name: 'Vimeo', type: 'video', icon: faVideo, color: '#1AB7EA' },
    { key: 'dailymotion', name: 'Dailymotion', type: 'video', icon: faVideo, color: '#00AEEF' },
    { key: 'tubitv', name: 'Tubi', type: 'video', icon: faVideo, color: '#E50914' },
    { key: 'pluto.tv', name: 'Pluto TV', type: 'video', icon: faVideo, color: '#C2185B' },
    { key: 'sling', name: 'Sling TV', type: 'video', icon: faVideo, color: '#00AEEF' },
    { key: 'rakuten', name: 'Rakuten TV', type: 'video', icon: faVideo, color: '#E60012' },
    { key: 'zee5', name: 'ZEE5', type: 'video', icon: faVideo, color: '#FF0066' },
    { key: 'mxplayer', name: 'MX Player', type: 'video', icon: faVideo, color: '#0078FF' },
    { key: 'sonyliv', name: 'SonyLIV', type: 'video', icon: faVideo, color: '#FFAA00' },
    { key: 'voot', name: 'Voot', type: 'video', icon: faVideo, color: '#6A0DAD' },
    { key: 'tiktok', name: 'TikTok', type: 'video', icon: faVideo, color: '#000000' },
    { key: 'instagram', name: 'Instagram Reels', type: 'video', icon: faVideo, color: '#E1306C' },
  ];


  const detectAppFromTab = (tab) => {
    let hostname = '';
    try { hostname = new URL(tab.url).hostname.toLowerCase(); } catch (e) { }
    const titleLower = (tab.title || '').toLowerCase();
    return map.find(m => hostname.includes(m.key) || titleLower.includes(m.key));
  };

  const findMediaTabs = async () => {
    const all = await chrome.tabs.query({});
    const media = all
      .map(tab => {
        const app = detectAppFromTab(tab);
        if (app) return { id: tab.id, url: tab.url, title: tab.title, app };
        return null;
      })
      .filter(Boolean);
    setMediaApps(media);
    setActiveApp(prev => {
      if (prev) {
        const match = media.find(m => m.id === prev.id);
        if (match) return match;
      }
      return media[0] || null;
    });
    setHasMediaTarget(media.length > 0);
  };

  const sendMediaCommand = async (action, tabId) => {
    if (!chrome?.scripting?.executeScript || !tabId) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (action) => {
        const tryClick = (selectors) => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { el.click(); return true; }
          }
          return false;
        };

        const toggleMediaElement = (action) => {
          const media = document.querySelector('video, audio');
          if (!media) return false;

          try {
            if (action === 'play') {
              const playPromise = media.play?.();
              if (playPromise?.catch) playPromise.catch(() => {});
            } else if (action === 'pause') {
              if (!media.paused) media.pause();
            }
            return true;
          } catch (error) {
            console.warn('[MusicControls] Failed media toggle via element:', error);
            return false;
          }
        };

        if (action === 'play' || action === 'pause') {
          const handled = toggleMediaElement(action);

          if ('mediaSession' in navigator && navigator.mediaSession.playbackState) {
            navigator.mediaSession.playbackState = action === 'play' ? 'playing' : 'paused';
          }

          if (!handled) {
            tryClick([
              '.ytp-play-button',
              '.ytp-play-button.ytp-button',
              '[data-testid="control-button-playpause"]',
              '#play-pause-button',
              '.vjs-play-control',
              '[data-testid*="play-pause"]',
              'button[aria-label="Play"]',
              'button[aria-label="Pause"]',
              'button[aria-label="play"]',
              'button[aria-label="pause"]',
              'button[data-testid="hlt-player-play-pause-button"]',
              '[data-testid="pause-icon"]',
              '[data-testid="play-icon"]'
            ]);
          }
        } else if (action === 'nexttrack') {
          tryClick([
            '.ytp-next-button',
            '[data-testid="control-button-skip-forward"]',
            'button[aria-label*="Next"]',
            'button[data-testid*="next"]'
          ]);
        } else if (action === 'previoustrack') {
          tryClick([
            '.ytp-prev-button',
            '[data-testid="control-button-skip-back"]',
            'button[aria-label*="Previous"]',
            'button[data-testid*="prev"]'
          ]);
        }
      },
      args: [action],
    });
  };

  const checkMediaState = useCallback(async () => {
    if (!activeApp?.id || !chrome?.scripting?.executeScript) return;
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: activeApp.id },
        func: () => {
          const media = document.querySelector('video, audio');
          let hasControlSurface = false;

          if (media) {
            hasControlSurface = true;
            return { playing: !media.paused, hasControl: true };
          }

          if ('mediaSession' in navigator && navigator.mediaSession.playbackState) {
            const state = navigator.mediaSession.playbackState;
            if (state === 'playing') return { playing: true, hasControl: true };
            if (state === 'paused') return { playing: false, hasControl: true };
          }

          const pauseSelectors = [
            '[data-testid="pause-icon"]',
            'button[aria-label="Pause"]',
            'button[aria-label="pause"]',
            '.vjs-play-control.vjs-playing',
            'button[data-testid*="pause"]'
          ];
          const playSelectors = [
            '[data-testid="play-icon"]',
            'button[aria-label="Play"]',
            'button[aria-label="play"]',
            '.vjs-play-control.vjs-paused',
            'button[data-testid*="play"]'
          ];

          const hasPause = pauseSelectors.some(sel => document.querySelector(sel));
          const hasPlay = playSelectors.some(sel => document.querySelector(sel));

          if (hasPause || hasPlay) {
            hasControlSurface = true;
          }

          if (hasPause && !hasPlay) return { playing: true, hasControl: true };
          if (hasPlay && !hasPause) return { playing: false, hasControl: true };

          return { playing: null, hasControl: hasControlSurface };
        },
      });

      const inferred = result?.result || {};
      if (typeof inferred.playing === 'boolean') {
        setIsPlaying(inferred.playing);
      }
      setHasMediaTarget(Boolean(inferred.hasControl));
    } catch {
      setHasMediaTarget(false);
    }
  }, [activeApp]);

  const handlePlayPause = async () => {
    if (!activeApp || !hasMediaTarget) return;
    const newState = !isPlaying;
    setIsPlaying(newState);
    await sendMediaCommand(newState ? 'play' : 'pause', activeApp.id);
    setTimeout(() => checkMediaState(), 200);
  };

  const handleNext = () => activeApp && sendMediaCommand('nexttrack', activeApp.id);
  const handlePrevious = () => activeApp && sendMediaCommand('previoustrack', activeApp.id);

  const handleAppSwitch = (app) => {
    setActiveApp(app);
    setDropdownOpen(false);
    setTimeout(() => checkMediaState(), 100);
  };

  useEffect(() => {
    findMediaTabs();
    chrome.tabs.onUpdated.addListener(findMediaTabs);
    chrome.tabs.onActivated.addListener(findMediaTabs);
    return () => {
      chrome.tabs.onUpdated.removeListener(findMediaTabs);
      chrome.tabs.onActivated.removeListener(findMediaTabs);
    };
  }, []);

  useEffect(() => {
    if (activeApp) checkMediaState();
  }, [activeApp, checkMediaState]);

  if (mediaApps.length === 0) return null;

  return (
    <div className="music-controls" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: 'var(--glass-bg, rgba(255,255,255,0.05))',
      border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
      borderRadius: '10px',
      padding: '6px 10px',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Active App + Dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: `${activeApp.app.color}22`,
            border: `1px solid ${activeApp.app.color}`,
            borderRadius: '8px',
            padding: '4px 8px',
            cursor: 'pointer'
          }}
        >
          {activeApp.favIconUrl ? (
            <img src={activeApp.favIconUrl} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />
          ) : (
            <FontAwesomeIcon icon={activeApp.app.icon} />
          )}
          {activeApp.app.name}
          <span style={{ marginLeft: '4px' }}>▾</span>
        </button>
        {dropdownOpen && (
          <div style={{
            position: 'absolute',
            bottom: '100%', // <-- expand upwards
            left: 0,
            background: 'rgba(0,0,0,0.8)',
            borderRadius: '8px',
            marginBottom: 4, // space between button and dropdown
            overflow: 'hidden',
            zIndex: 1000
          }}>
            {mediaApps.filter(app => app.id !== activeApp.id).map(app => (
              <div
                key={app.id}
                onClick={() => handleAppSwitch(app)}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: '#fff',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${app.app.color}33`}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {app.favIconUrl ? (
                  <img src={app.favIconUrl} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />
                ) : (
                  <FontAwesomeIcon icon={app.app.icon} />
                )}
                {app.app.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button onClick={handlePrevious} disabled={!activeApp} title="Previous Track"
          style={{ opacity: activeApp ? 1 : 0.4, cursor: activeApp ? 'pointer' : 'not-allowed', borderRadius: '8px', border: 'none', padding: '6px 8px', background: 'rgba(255,255,255,0.1)' }}>
          <FontAwesomeIcon icon={faBackward} />
        </button>

        <button onClick={handlePlayPause} disabled={!activeApp} title={isPlaying ? 'Pause' : 'Play'}
          style={{
            background: isPlaying && activeApp
              ? `linear-gradient(135deg, ${activeApp.app.color}, var(--accent-secondary, #30D158))`
              : 'rgba(255,255,255,0.1)',
            borderRadius: '50%',
            padding: '8px 10px',
            border: 'none',
            color: '#fff',
            transform: isPlaying ? 'scale(1.1)' : 'scale(1)',
            boxShadow: isPlaying ? `0 0 8px ${activeApp.app.color}` : 'none',
            transition: 'all 0.25s ease',
            opacity: activeApp ? 1 : 0.4,
            cursor: activeApp ? 'pointer' : 'not-allowed'
          }}
        >
          <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
        </button>

        <button onClick={handleNext} disabled={!activeApp} title="Next Track"
          style={{ opacity: activeApp ? 1 : 0.4, cursor: activeApp ? 'pointer' : 'not-allowed', borderRadius: '8px', border: 'none', padding: '6px 8px', background: 'rgba(255,255,255,0.1)' }}>
          <FontAwesomeIcon icon={faForward} />
        </button>
      </div>
    </div>
  );
}
