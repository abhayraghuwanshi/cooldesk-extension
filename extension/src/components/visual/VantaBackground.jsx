import React, { useEffect, useRef, useState } from 'react';

// Lightweight Vanta loader via CDN (no npm install required)
// Effects available via CDN include: birds, waves, fog, clouds, net, cells, halos, etc.
// Here we start with WAVES. Change EFFECT_NAME to try others.
const VANTA_EFFECT = 'waves';
const VANTA_SRC = `https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.${VANTA_EFFECT}.min.js`;
const THREE_SRC = 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js';

export function VantaBackground({ enabled = true, options = {} }) {
  const containerRef = useRef(null);
  const vantaRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const ensureScript = (src) => new Promise((resolve, reject) => {
      // Already present?
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });

    const load = async () => {
      try {
        // three.js is required before Vanta
        await ensureScript(THREE_SRC);
        await ensureScript(VANTA_SRC);
        if (disposed) return;
        setLoaded(true);
        if (!containerRef.current) return;

        const baseOptions = {
          el: containerRef.current,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200.0,
          minWidth: 200.0,
          // Good defaults; can be tweaked from props
          color: 0x3355aa,
          shininess: 35.0,
          waveHeight: 12.0,
          waveSpeed: 0.65,
          zoom: 1.0,
          // Overlays nicely under content
          scale: 1.0,
          scaleMobile: 1.0,
        };

        const opts = { ...baseOptions, ...options };
        const VANTA = window.VANTA;
        if (VANTA && typeof VANTA.WAVES === 'function') {
          vantaRef.current = VANTA.WAVES(opts);
        } else {
          // If a different effect is used, try generic accessor
          const effectName = (VANTA_EFFECT || '').toUpperCase();
          if (VANTA && VANTA[effectName]) {
            vantaRef.current = VANTA[effectName](opts);
          }
        }
      } catch (e) {
        // Non-fatal; background won't render
        // console.warn('Vanta load failed', e);
      }
    };

    load();

    return () => {
      disposed = true;
      try { vantaRef.current && vantaRef.current.destroy && vantaRef.current.destroy(); } catch {}
      vantaRef.current = null;
    };
  }, [enabled, options]);

  // Fixed full-viewport layer behind app content
  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
      }}
      aria-hidden
      data-vanta-loaded={loaded ? 'true' : 'false'}
    />
  );
}
