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
    // FIXED: Calculate actual scroll depth as percentage of scrollable content
    const docHeight = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body.scrollHeight || 0,
      document.documentElement.offsetHeight || 0
    );
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const scrollableHeight = Math.max(1, docHeight - viewportHeight);
    const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

    // scrollPercent is 0-1 representing how far down the user has scrolled
    const scrollPercent = Math.max(0, Math.min(1, scrollTop / scrollableHeight));

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

// Generic Audio/Video Detection (YouTube, Twitch, Pandora, etc.)
let activeMediaCount = 0;
let audioHeartbeatInterval = null;

function updateAudioHeartbeat() {
  if (activeMediaCount > 0) {
    if (!audioHeartbeatInterval) {
      // Start heartbeat - send every 5 seconds
      sendInteraction('audioHeartbeat', { playing: true }); // Send immediately
      audioHeartbeatInterval = setInterval(() => {
        sendInteraction('audioHeartbeat', { playing: true });
      }, 5000);
    }
  } else {
    if (audioHeartbeatInterval) {
      clearInterval(audioHeartbeatInterval);
      audioHeartbeatInterval = null;
      sendInteraction('audioHeartbeat', { playing: false });
    }
  }
}

// Use capture phase to detect play/pause on any media element
try {
  window.addEventListener('play', (e) => {
    if (e.target instanceof HTMLMediaElement) {
      activeMediaCount++;
      updateAudioHeartbeat();
    }
  }, true);

  window.addEventListener('pause', (e) => {
    if (e.target instanceof HTMLMediaElement) {
      activeMediaCount = Math.max(0, activeMediaCount - 1);
      updateAudioHeartbeat();
    }
  }, true);

  window.addEventListener('ended', (e) => {
    if (e.target instanceof HTMLMediaElement) {
      activeMediaCount = Math.max(0, activeMediaCount - 1);
      updateAudioHeartbeat();
    }
  }, true);
} catch { /* no-op */ }

// SPA Navigation Detection (History API) for X.com, YouTube, etc.
try {
  // Only patch if not already patched (check simply)
  if (!history.pushState.patched) {
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      sendInteraction('navigation', { url: location.href });
    };
    history.pushState.patched = true;

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      sendInteraction('navigation', { url: location.href });
    };

    window.addEventListener('popstate', () => {
      sendInteraction('navigation', { url: location.href });
    });
  }
} catch { /* no-op */ }

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

// Note: Content interactions (scroll, click, visibility, media) are tracked above
// Notes/highlights rendering and context menu handlers are below

// ========== Notes & Highlights Rendering ==========

// Store for active highlights (for mutation observer)
let activeHighlights = [];
let notesObserver = null;

// Load and render existing notes for this URL
async function loadAndRenderNotes() {
  try {
    console.log('[CoolDesk] Loading notes for:', window.location.href);
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getUrlNotes', url: window.location.href }, resolve);
    });

    if (!response?.success || !response?.notes?.length) {
      console.log('[CoolDesk] No notes to render');
      return;
    }

    console.log('[CoolDesk] Found', response.notes.length, 'notes');

    // Clear existing rendered notes
    document.querySelectorAll('.cooldesk-sticky-rendered').forEach(el => el.remove());
    document.querySelectorAll('mark.cooldesk-text-highlight').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });

    const stickyNotes = response.notes.filter(n => n.type !== 'highlight');
    const highlights = response.notes.filter(n => n.type === 'highlight');

    // Store and setup observer for highlights
    activeHighlights = highlights;
    setupHighlightObserver();

    // Render
    stickyNotes.forEach((note, i) => renderStickyCard(note, i));
    highlights.forEach(renderInlineHighlight);
  } catch (e) {
    console.warn('[CoolDesk] Failed to load notes:', e);
  }
}

// Render a sticky note card
function renderStickyCard(note, index) {
  const card = document.createElement('div');
  card.className = 'cooldesk-sticky-rendered';
  card.dataset.noteId = note.id;

  const top = 100 + (index * 45);
  const right = 80 + (index * 5);

  card.style.cssText = `
    position: fixed;
    top: ${top}px;
    right: ${right}px;
    width: 220px;
    min-height: 120px;
    background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%);
    color: #1f2937;
    border-radius: 4px 4px 16px 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    z-index: ${2147483640 + index};
    display: flex;
    flex-direction: column;
    overflow: hidden;
    cursor: move;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 12px;
    border-bottom: 1px solid rgba(0,0,0,0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #6b7280;
    background: rgba(255,255,255,0.3);
  `;

  const dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString() : '';
  header.innerHTML = `<span style="font-weight:600; color:#059669;">📝 Note</span><span>${dateStr}</span>`;

  // Close button
  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = '×';
  closeBtn.style.cssText = 'cursor:pointer; font-size:16px; margin-left:8px; color:#9ca3af;';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    card.remove();
  };
  header.appendChild(closeBtn);

  // Content
  const content = document.createElement('div');
  content.style.cssText = `
    padding: 12px;
    flex: 1;
    overflow-y: auto;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  `;
  content.textContent = note.text || '';

  card.appendChild(header);
  card.appendChild(content);

  // Dragging
  let isDragging = false;
  let startX, startY, startRight, startTop;

  header.onmousedown = (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startRight = parseInt(card.style.right);
    startTop = parseInt(card.style.top);
    e.preventDefault();
  };

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = startX - e.clientX;
    const dy = e.clientY - startY;
    card.style.right = (startRight + dx) + 'px';
    card.style.top = (startTop + dy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  document.body.appendChild(card);
}

// Render inline text highlight
function renderInlineHighlight(note) {
  if (!note.text?.trim()) return;

  try {
    const searchStr = note.text.trim();

    // Walk through text nodes to find and highlight
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('.cooldesk-sticky-rendered, .cooldesk-sticky-overlay')) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains('cooldesk-text-highlight')) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // Collect matching nodes
    const matches = [];
    let currentNode;
    while (currentNode = walker.nextNode()) {
      const idx = currentNode.nodeValue.indexOf(searchStr);
      if (idx !== -1) {
        matches.push({ node: currentNode, index: idx });
      }
    }

    // Highlight first match found
    if (matches.length > 0) {
      const { node, index } = matches[0];
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + searchStr.length);

      const mark = document.createElement('mark');
      mark.className = 'cooldesk-text-highlight';
      mark.style.cssText = 'background: #fef08a; padding: 2px 0; border-radius: 2px;';
      mark.dataset.noteId = note.id;

      try {
        range.surroundContents(mark);
      } catch (e) {
        // Range crosses element boundaries, skip
        console.debug('[CoolDesk] Could not highlight (crosses boundaries)');
      }
    }
  } catch (e) {
    console.debug('[CoolDesk] Highlight render failed:', e);
  }
}

// Observer to re-apply highlights on dynamic content
function setupHighlightObserver() {
  if (notesObserver) {
    notesObserver.disconnect();
  }

  notesObserver = new MutationObserver(() => {
    // Debounce re-highlighting
    clearTimeout(notesObserver._timeout);
    notesObserver._timeout = setTimeout(() => {
      if (activeHighlights.length > 0) {
        activeHighlights.forEach(renderInlineHighlight);
      }
    }, 1000);
  });

  notesObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initial load of notes
setTimeout(loadAndRenderNotes, 1500);

// ========== Context Menu Action Handlers ==========

// Show notification toast
function showNotification(message, color = '#4A90E2', duration = 3000) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2147483647;
    background: ${color};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(styleEl);
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => {
      notification.remove();
      styleEl.remove();
    }, 300);
  }, duration);
}

// Handle highlight action
function handleHighlight(selectionText) {
  if (!selectionText) {
    showNotification('No text selected', '#ef4444');
    return;
  }

  // Create highlight note
  const note = {
    id: 'note_' + Date.now(),
    url: window.location.href,
    text: selectionText,
    type: 'highlight',
    createdAt: Date.now()
  };

  chrome.runtime.sendMessage({ action: 'saveUrlNote', note }, (response) => {
    if (response?.success) {
      showNotification('Highlight saved!', '#10b981');
      // Visually highlight the text immediately
      try {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const highlight = document.createElement('mark');
          highlight.className = 'cooldesk-text-highlight';
          highlight.style.cssText = 'background: #fef08a; padding: 2px 0; border-radius: 2px;';
          highlight.dataset.noteId = note.id;
          range.surroundContents(highlight);
          selection.removeAllRanges();
        }
      } catch (e) {
        console.debug('[CoolDesk] Could not visually highlight:', e);
      }
      // Add to active highlights for observer
      activeHighlights.push(note);
    } else {
      showNotification('Failed to save highlight', '#ef4444');
    }
  });
}

// Handle scrape links action
function handleScrapeLinks(pageUrl) {
  const links = [];
  const seen = new Set();

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    const text = a.textContent?.trim() || '';
    if (href && !seen.has(href) && href.startsWith('http')) {
      seen.add(href);
      links.push({
        url: href,
        title: text || href,
        source: window.location.hostname
      });
    }
  });

  if (links.length === 0) {
    showNotification('No links found on this page', '#f59e0b');
    return;
  }

  // Send to background to save/process
  chrome.runtime.sendMessage({
    action: 'scrapedLinks',
    data: {
      pageUrl: pageUrl || window.location.href,
      pageTitle: document.title,
      links: links,
      scrapedAt: Date.now()
    }
  }, (response) => {
    if (response?.success) {
      showNotification(`Scraped ${links.length} links!`, '#10b981');
    } else {
      showNotification('Links scraped (check CoolDesk)', '#3b82f6');
    }
  });

  console.log('[CoolDesk] Scraped links:', links.length);
}

// Handle sticky note creation
function handleStickyNote(selectionText, pageUrl) {
  // Create floating sticky note editor
  const overlay = document.createElement('div');
  overlay.id = 'cooldesk-sticky-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3);
    z-index: 2147483646;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const stickyNote = document.createElement('div');
  stickyNote.style.cssText = `
    width: 320px;
    min-height: 200px;
    background: linear-gradient(135deg, #fef9c3 0%, #fef08a 100%);
    border-radius: 4px 4px 20px 4px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 12px 16px;
    border-bottom: 1px solid rgba(0,0,0,0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    background: rgba(255,255,255,0.3);
  `;
  header.innerHTML = `<span style="font-weight:600; color:#059669;">📝 New Note</span><span style="color:#9ca3af; font-size:11px;">${window.location.hostname}</span>`;

  const textarea = document.createElement('textarea');
  textarea.value = selectionText || '';
  textarea.placeholder = 'Type your note here...';
  textarea.style.cssText = `
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    padding: 16px;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.6;
    min-height: 120px;
    color: #374151;
  `;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; background: rgba(255,255,255,0.2);';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background: transparent; border: none; padding: 8px 16px; cursor: pointer; color: #6b7280; font-size: 13px; font-weight: 500; border-radius: 6px;';
  cancelBtn.onmouseenter = () => cancelBtn.style.background = 'rgba(0,0,0,0.05)';
  cancelBtn.onmouseleave = () => cancelBtn.style.background = 'transparent';
  cancelBtn.onclick = () => overlay.remove();

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Note';
  saveBtn.style.cssText = 'background: #10b981; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; color: white; font-size: 13px; font-weight: 600; transition: all 0.2s;';
  saveBtn.onmouseenter = () => saveBtn.style.background = '#059669';
  saveBtn.onmouseleave = () => saveBtn.style.background = '#10b981';

  saveBtn.onclick = () => {
    const text = textarea.value.trim();
    if (!text) {
      showNotification('Please enter some text', '#f59e0b');
      return;
    }

    const note = {
      id: 'note_' + Date.now(),
      url: pageUrl || window.location.href,
      text: text,
      type: 'note',
      createdAt: Date.now()
    };

    chrome.runtime.sendMessage({ action: 'saveUrlNote', note }, (response) => {
      if (response?.success) {
        showNotification('Note saved!', '#10b981');
        overlay.remove();
        // Refresh to show the new note
        loadAndRenderNotes();
      } else {
        showNotification('Failed to save note', '#ef4444');
      }
    });
  };

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);

  stickyNote.appendChild(header);
  stickyNote.appendChild(textarea);
  stickyNote.appendChild(btnRow);
  overlay.appendChild(stickyNote);

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 50);
}

// Handle add to workspace action
function handleAddToWorkspace(pageUrl, pageTitle) {
  // Send to background to show workspace picker or save directly
  chrome.runtime.sendMessage({
    action: 'addUrlToWorkspace',
    data: {
      url: pageUrl || window.location.href,
      title: pageTitle || document.title,
      favicon: document.querySelector('link[rel*="icon"]')?.href || ''
    }
  }, (response) => {
    if (response?.success) {
      showNotification(`Added to ${response.workspace || 'workspace'}!`, '#10b981');
    } else {
      showNotification('Open CoolDesk to add to workspace', '#3b82f6');
    }
  });
}

// Listen for messages from background (context menu actions)
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Preview collection
    if (msg?.action === 'collectPreview') {
      try {
        const data = collectPreviewFromDom();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'Failed to collect preview' });
      }
      return true;
    }

    // Context menu actions
    if (msg?.type === 'COOLDESK_HIGHLIGHT') {
      handleHighlight(msg.selectionText);
      sendResponse({ ok: true });
      return true;
    }

    if (msg?.type === 'COOLDESK_SCRAPE_LINKS') {
      handleScrapeLinks(msg.pageUrl);
      sendResponse({ ok: true });
      return true;
    }

    if (msg?.type === 'COOLDESK_STICKY_NOTE') {
      handleStickyNote(msg.selectionText, msg.pageUrl);
      sendResponse({ ok: true });
      return true;
    }

    if (msg?.type === 'COOLDESK_ADD_TO_WORKSPACE') {
      handleAddToWorkspace(msg.pageUrl, msg.pageTitle);
      sendResponse({ ok: true });
      return true;
    }

    // Refresh notes when background notifies us
    if (msg?.action === 'refreshNotesCount') {
      loadAndRenderNotes();
      return;
    }
  });
} catch { }
