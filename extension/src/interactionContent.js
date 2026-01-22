// Send user interactions to background script
function sendInteraction(type, extra = {}) {
  try {
    // Check if extension context is valid
    if (!chrome?.runtime?.id) {
      console.debug('[CoolDesk] Extension context invalidated, skipping interaction');
      return;
    }

    chrome.runtime.sendMessage({ type, url: window.location.href, ...extra }, (response) => {
      // Handle response if needed, but don't expect one for most interactions
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message;
        // Only log non-connection errors in debug mode
        if (!error.includes('Could not establish connection') &&
          !error.includes('Receiving end does not exist') &&
          !error.includes('message port closed')) {
          console.debug('[CoolDesk] Interaction message error:', error);
        }
      }
    });
  } catch (error) {
    // Silently ignore errors for fire-and-forget messages
    console.debug('[CoolDesk] Failed to send interaction:', error?.message);
  }
}

// Scroll tracking (report scroll percentage on scroll events with throttling)
let lastScrollPercent = 0;
let scrollTimeout = null;

// Throttled scroll handler - only check scroll every 3 seconds max
const handleScroll = () => {
  if (scrollTimeout) return; // Already scheduled

  scrollTimeout = setTimeout(() => {
    const total = Math.max(1, document.documentElement.scrollHeight || document.body.scrollHeight || 1);
    const viewportBottom = (window.scrollY || window.pageYOffset || 0) + window.innerHeight;
    const scrollPercent = Math.max(0, Math.min(1, viewportBottom / total));

    if (Math.abs(scrollPercent - lastScrollPercent) >= 0.05) {
      lastScrollPercent = scrollPercent;
      sendInteraction('scroll', { scrollPercent: Number(scrollPercent.toFixed(3)) });
    }

    scrollTimeout = null;
  }, 3000);
};

// Use event listener instead of interval
addEventListener('scroll', handleScroll, { passive: true });

// Click tracking
addEventListener('click', (e) => {
  const tag = e.target && e.target.tagName ? e.target.tagName : 'UNKNOWN';
  sendInteraction('click', { element: tag });
}, true);

// Form submission tracking
addEventListener('submit', (e) => {
  const id = e.target && (e.target.id || e.target.name) ? (e.target.id || e.target.name) : null;
  sendInteraction('formSubmit', { formId: id });
}, true);

// Visibility change
addEventListener('visibilitychange', () => {
  sendInteraction('visibility', { visible: !document.hidden });
});

// Text selection tracking (like Sider AI) - with debouncing to avoid excessive captures


// Collect preview data from the live DOM (for client-rendered pages)
function collectPreviewFromDom() {
  try {
    const getMeta = (name) => {
      const el = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
      return el ? el.getAttribute('content') || '' : '';
    };
    const absUrl = (u) => {
      try { return new URL(u, document.baseURI).toString(); } catch { return u || ''; }
    };
    const title = getMeta('og:title') || getMeta('twitter:title') || document.title || '';
    const description = getMeta('og:description') || getMeta('description') || getMeta('twitter:description') || '';
    const image = absUrl(getMeta('og:image') || getMeta('twitter:image'));
    let fallbackDesc = description;
    if (!fallbackDesc) {
      const h1 = document.querySelector('h1');
      const p = document.querySelector('main p, article p, p');
      fallbackDesc = (h1?.textContent || '').trim();
      const ptxt = (p?.textContent || '').trim();
      if (ptxt && (!fallbackDesc || ptxt.length > fallbackDesc.length)) fallbackDesc = ptxt;
    }
    return {
      source: location.hostname,
      title,
      description: description || fallbackDesc || '',
      image: image || '',
      url: location.href
    };
  } catch (e) {
    return { source: location.hostname, title: document.title || '', description: '', image: '', url: location.href };
  }
}

// Listen for preview collection requests from extension UI
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'collectPreview') {
      try {
        const data = collectPreviewFromDom();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'Failed to collect preview' });
      }
      return true;
    }
  });
} catch { }

import { initContentInteractions } from './contentInteractions.js';
import { injectFooterBar } from './footerBar.js';

// Initialize content interactions (analytics, preview collection)
try {
  initContentInteractions();
  console.debug('[CoolDesk] contentInteractions initialized');
} catch (e) {
  console.warn('[CoolDesk] contentInteractions init failed', e);
}

// Initialize footer bar (floating button)
try {
  injectFooterBar();
  console.debug('[CoolDesk] footerBar initialized');
} catch (e) {
  console.warn('[CoolDesk] footerBar init failed', e);
}
