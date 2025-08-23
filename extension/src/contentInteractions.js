// Interaction tracking and preview collection for content pages

export function initContentInteractions() {
  // Send user interactions to background script
  function sendInteraction(type, extra = {}) {
    try {
      chrome.runtime.sendMessage({ type, url: window.location.href, ...extra });
    } catch { /* no-op */ }
  }

  // Scroll tracking (report scroll percentage at most every 3s; only if change > 5%)
  let lastScrollPercent = 0;
  try {
    setInterval(() => {
      const total = Math.max(1, document.documentElement.scrollHeight || document.body.scrollHeight || 1);
      const viewportBottom = (window.scrollY || window.pageYOffset || 0) + window.innerHeight;
      const scrollPercent = Math.max(0, Math.min(1, viewportBottom / total));
      if (Math.abs(scrollPercent - lastScrollPercent) >= 0.05) {
        lastScrollPercent = scrollPercent;
        sendInteraction('scroll', { scrollPercent: Number(scrollPercent.toFixed(3)) });
      }
    }, 3000);
  } catch { /* no-op */ }

  // Click tracking
  try {
    addEventListener('click', (e) => {
      const tag = e.target && e.target.tagName ? e.target.tagName : 'UNKNOWN';
      sendInteraction('click', { element: tag });
    }, true);
  } catch { /* no-op */ }

  // Form submission tracking
  try {
    addEventListener('submit', (e) => {
      const id = e.target && (e.target.id || e.target.name) ? (e.target.id || e.target.name) : null;
      sendInteraction('formSubmit', { formId: id });
    }, true);
  } catch { /* no-op */ }

  // Visibility change
  try {
    addEventListener('visibilitychange', () => {
      sendInteraction('visibility', { visible: !document.hidden });
    });
  } catch { /* no-op */ }

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
  } catch { /* no-op */ }
}

export default initContentInteractions;
