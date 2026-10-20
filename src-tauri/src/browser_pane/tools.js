// CoolDesk page tools — highlights and notes on any page in the browser pane.
//
// Runs in the isolated "cooldesk" WKContentWorld (see tools.rs): it shares
// the page's DOM but none of its JavaScript, so the site can't see, call or
// tamper with anything here, and `window.webkit.messageHandlers.cooldesk`
// (our channel back to the app) only exists in this world.
//
// Highlights are drawn with the CSS Custom Highlight API — ranges are styled
// without touching the page's DOM, so frameworks that re-render don't break.
// They're stored as text quotes (exact text + a little context before and
// after, the W3C web-annotation approach) and re-found on every visit.
// Our UI (selection toolbar, note popover) lives in a closed shadow root.
(() => {
  if (window.__cdTools) return;

  const post = (msg) => {
    try { window.webkit.messageHandlers.cooldesk.postMessage(JSON.stringify(msg)); } catch { /* not in a pane */ }
  };

  const COLORS = { yellow: '#fde047', green: '#86efac', blue: '#93c5fd', pink: '#f9a8d4', purple: '#c4b5fd' };
  const CONTEXT = 32;
  const supported = typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights;

  // ── Painting ─────────────────────────────────────────────────────────
  const registry = {};
  if (supported) {
    for (const c of Object.keys(COLORS)) {
      registry[c] = new Highlight();
      CSS.highlights.set(`cd-${c}`, registry[c]);
    }
    registry.focus = new Highlight();
    registry.focus.priority = 1;
    CSS.highlights.set('cd-focus', registry.focus);
    registry.find = new Highlight();
    registry.find.priority = 2;
    CSS.highlights.set('cd-find', registry.find);
    registry.findCurrent = new Highlight();
    registry.findCurrent.priority = 3;
    CSS.highlights.set('cd-find-current', registry.findCurrent);
    const style = document.createElement('style');
    style.textContent = Object.entries(COLORS)
      .map(([c, v]) => `::highlight(cd-${c}) { background-color: ${v}aa; }`)
      .join('\n') + '\n::highlight(cd-focus) { background-color: #f59e0bcc; }'
      + '\n::highlight(cd-find) { background-color: #facc1588; }'
      + '\n::highlight(cd-find-current) { background-color: #f97316; color: #fff; }';
    (document.head || document.documentElement).appendChild(style);
  }

  /** id → { color, note, quote, range } */
  const marks = new Map();

  const paint = () => {
    if (!supported) return;
    for (const c of Object.keys(COLORS)) registry[c].clear();
    for (const m of marks.values()) if (m.range && registry[m.color]) registry[m.color].add(m.range);
  };

  // ── Text index: the page's visible text with a map back to DOM nodes ──
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'IFRAME', 'SVG']);
  let host = null;

  function buildIndex() {
    const nodes = [];
    let text = '';
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        for (let p = n.parentElement; p; p = p.parentElement) {
          if (SKIP.has(p.tagName) || p === host) return NodeFilter.FILTER_REJECT;
        }
        return n.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { nodes, text };
  }

  function locate(index, offset) {
    // Last node starting at or before offset (binary search).
    let lo = 0;
    let hi = index.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (index.nodes[mid].start <= offset) lo = mid; else hi = mid - 1;
    }
    const entry = index.nodes[lo];
    return entry ? { node: entry.node, offset: Math.min(offset - entry.start, entry.node.nodeValue.length) } : null;
  }

  function offsetOf(index, node, offset) {
    if (node.nodeType !== Node.TEXT_NODE) {
      // Element boundary: use the first text node at/after that child.
      const child = node.childNodes[offset] || null;
      const probe = child ? document.createTreeWalker(child, NodeFilter.SHOW_TEXT).nextNode() || child : node;
      const hit = index.nodes.find(e => probe === e.node || (probe.contains && probe.contains(e.node)));
      return hit ? hit.start : -1;
    }
    const hit = index.nodes.find(e => e.node === node);
    return hit ? hit.start + offset : -1;
  }

  function quoteOf(range) {
    const index = buildIndex();
    const start = offsetOf(index, range.startContainer, range.startOffset);
    const end = offsetOf(index, range.endContainer, range.endOffset);
    const exact = start >= 0 && end > start ? index.text.slice(start, end) : range.toString();
    return {
      exact,
      prefix: start >= 0 ? index.text.slice(Math.max(0, start - CONTEXT), start) : '',
      suffix: end >= 0 ? index.text.slice(end, end + CONTEXT) : '',
    };
  }

  // Common-suffix / common-prefix length, for scoring context matches.
  const tailMatch = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
  const headMatch = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

  function anchor(index, quote) {
    if (!quote?.exact) return null;
    let best = null;
    let bestScore = -1;
    for (let at = index.text.indexOf(quote.exact); at !== -1; at = index.text.indexOf(quote.exact, at + 1)) {
      const before = index.text.slice(Math.max(0, at - CONTEXT), at);
      const after = index.text.slice(at + quote.exact.length, at + quote.exact.length + CONTEXT);
      const score = tailMatch(before, quote.prefix || '') + headMatch(after, quote.suffix || '');
      if (score > bestScore) { best = at; bestScore = score; }
      if (bestScore >= (quote.prefix || '').length + (quote.suffix || '').length) break;
    }
    if (best === null) return null;
    const s = locate(index, best);
    const e = locate(index, best + quote.exact.length);
    if (!s || !e) return null;
    try {
      const range = document.createRange();
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
      return range;
    } catch { return null; }
  }

  function reanchor(all) {
    const index = buildIndex();
    for (const m of marks.values()) {
      if (all || !m.range || !m.range.startContainer.isConnected) m.range = anchor(index, m.quote);
    }
    paint();
  }

  // Pages that re-render (SPAs, infinite feeds): re-find lost highlights.
  let reanchorTimer = 0;
  new MutationObserver((records) => {
    if (!marks.size) return;
    if (records.every(r => host && (r.target === host || host.contains(r.target)))) return;
    clearTimeout(reanchorTimer);
    reanchorTimer = setTimeout(() => reanchor(false), 600);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // ── Our UI: closed shadow root, fixed on top of the page ─────────────
  host = document.createElement('cooldesk-tools');
  host.style.cssText = 'all: initial; position: fixed; inset: 0 auto auto 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bar, .pop {
        position: fixed; display: none; pointer-events: auto;
        font: 500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #e5e7eb; background: rgba(17, 18, 30, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px;
        box-shadow: 0 12px 34px -10px rgba(0, 0, 0, 0.6);
        -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      }
      .bar { padding: 5px; gap: 4px; align-items: center; }
      .bar.show, .pop.show { display: flex; }
      .dot {
        width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.18);
        cursor: pointer; padding: 0; transition: transform 120ms ease;
      }
      .dot:hover { transform: scale(1.15); }
      .dot.on { border-color: #fff; }
      .sep { width: 1px; height: 18px; background: rgba(255,255,255,0.14); margin: 0 3px; }
      .btn {
        border: none; background: none; color: inherit; font: inherit; cursor: pointer;
        padding: 4px 8px; border-radius: 8px;
      }
      .btn:hover { background: rgba(255,255,255,0.1); }
      .btn.danger:hover { color: #f87171; }
      .pop { flex-direction: column; gap: 8px; padding: 10px; width: 260px; }
      .row { display: flex; gap: 6px; align-items: center; }
      .grow { flex: 1; }
      textarea {
        box-sizing: border-box; width: 100%; min-height: 64px; resize: vertical;
        border-radius: 8px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.3);
        color: inherit; font: inherit; padding: 7px 8px; outline: none;
      }
      textarea:focus { border-color: #60a5fa; }
      .quote { color: #9ca3af; font-style: italic; max-height: 48px; overflow: hidden; }
    </style>
    <div class="bar" part="bar"></div>
    <div class="pop" part="pop">
      <div class="quote"></div>
      <div class="row colors"></div>
      <textarea placeholder="Add a note…"></textarea>
      <div class="row"><button class="btn danger del">Delete</button><span class="grow"></span><button class="btn done">Done</button></div>
    </div>`;
  (document.body || document.documentElement).appendChild(host);

  const bar = shadow.querySelector('.bar');
  const pop = shadow.querySelector('.pop');
  const noteBox = pop.querySelector('textarea');
  const popQuote = pop.querySelector('.quote');
  const popColors = pop.querySelector('.colors');

  const dot = (color, on) => {
    const b = document.createElement('button');
    b.className = `dot${on ? ' on' : ''}`;
    b.style.background = COLORS[color];
    b.title = color[0].toUpperCase() + color.slice(1);
    b.dataset.color = color;
    return b;
  };

  for (const c of Object.keys(COLORS)) bar.appendChild(dot(c, false));
  const sep = document.createElement('span'); sep.className = 'sep'; bar.appendChild(sep);
  const noteBtn = document.createElement('button'); noteBtn.className = 'btn'; noteBtn.textContent = 'Note'; bar.appendChild(noteBtn);
  const copyBtn = document.createElement('button'); copyBtn.className = 'btn'; copyBtn.textContent = 'Copy'; bar.appendChild(copyBtn);
  const mdBtn = document.createElement('button'); mdBtn.className = 'btn'; mdBtn.textContent = 'MD'; mdBtn.title = 'Copy as Markdown'; bar.appendChild(mdBtn);

  const place = (el, rect, below = false) => {
    el.classList.add('show');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2;
    let y = below ? rect.bottom + 8 : rect.top - h - 8;
    if (y < 8) y = rect.bottom + 8;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  const hideBar = () => bar.classList.remove('show');
  let editing = null; // id open in the popover

  function closePop(save = true) {
    if (editing && save) {
      const m = marks.get(editing);
      const note = noteBox.value.trim();
      if (m && note !== (m.note || '')) {
        m.note = note;
        post({ type: 'update', id: editing, note });
      }
    }
    editing = null;
    pop.classList.remove('show');
  }

  function openPop(id, rect) {
    const m = marks.get(id);
    if (!m) return;
    closePop();
    editing = id;
    popQuote.textContent = `“${m.quote.exact.slice(0, 140)}${m.quote.exact.length > 140 ? '…' : ''}”`;
    popColors.replaceChildren(...Object.keys(COLORS).map(c => dot(c, c === m.color)));
    noteBox.value = m.note || '';
    place(pop, rect, true);
    noteBox.focus();
  }

  function selectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (range.toString().trim().length < 2) return null;
    const el = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (el && el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return null;
    return range;
  }

  function create(color, withNote) {
    const range = selectionRange();
    if (!range) return;
    const quote = quoteOf(range);
    const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}${Math.random().toString(36).slice(2)}`;
    marks.set(id, { color, note: '', quote, range: range.cloneRange() });
    paint();
    post({ type: 'create', highlight: { id, color, note: '', quote }, title: document.title.slice(0, 300) });
    const rect = range.getBoundingClientRect();
    window.getSelection().removeAllRanges();
    hideBar();
    if (withNote) openPop(id, rect);
  }

  // Selection → toolbar.
  document.addEventListener('mouseup', (e) => {
    if (e.composedPath().includes(host)) return;
    setTimeout(() => {
      const range = selectionRange();
      if (range) place(bar, range.getBoundingClientRect());
      else hideBar();
    }, 0);
  }, true);
  document.addEventListener('selectionchange', () => { if (!selectionRange()) hideBar(); });
  window.addEventListener('scroll', () => { hideBar(); }, true);

  bar.addEventListener('mousedown', e => e.preventDefault()); // keep the selection
  bar.addEventListener('click', (e) => {
    const color = e.target.dataset?.color;
    if (color) return create(color, false);
    if (e.target === noteBtn) return create('yellow', true);
    if (e.target === copyBtn) {
      const range = selectionRange();
      if (range) navigator.clipboard.writeText(range.toString()).catch(() => { });
      hideBar();
    }
    if (e.target === mdBtn) {
      const range = selectionRange();
      if (range) navigator.clipboard.writeText(toMarkdown(range.cloneContents())).catch(() => { });
      hideBar();
    }
  });

  // Click a highlight → popover (colour, note, delete).
  document.addEventListener('click', (e) => {
    if (e.composedPath().includes(host)) return;
    if (!window.getSelection().isCollapsed) return;
    const caret = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!caret) return closePop();
    for (const [id, m] of marks) {
      try {
        if (m.range && m.range.isPointInRange(caret.startContainer, caret.startOffset)) {
          openPop(id, m.range.getBoundingClientRect());
          return;
        }
      } catch { /* detached range */ }
    }
    closePop();
  }, true);

  popColors.addEventListener('click', (e) => {
    const color = e.target.dataset?.color;
    const m = editing && marks.get(editing);
    if (!color || !m) return;
    m.color = color;
    paint();
    popColors.querySelectorAll('.dot').forEach(d => d.classList.toggle('on', d.dataset.color === color));
    post({ type: 'update', id: editing, color });
  });
  pop.querySelector('.done').addEventListener('click', () => closePop());
  pop.querySelector('.del').addEventListener('click', () => {
    if (!editing) return;
    marks.delete(editing);
    post({ type: 'delete', id: editing });
    paint();
    closePop(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideBar(); closePop(); }
  }, true);

  // ── Copy as Markdown ─────────────────────────────────────────────────
  function toMarkdown(fragment) {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
    const inline = (node) => [...node.childNodes].map(walk).join('');
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;
      if (SKIP.has(tag)) return '';
      const inner = () => inline(node).trim();
      switch (tag) {
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
          return `\n\n${'#'.repeat(Number(tag[1]))} ${inner()}\n\n`;
        case 'P': case 'DIV': case 'SECTION': case 'ARTICLE': case 'HEADER': case 'FOOTER': case 'MAIN':
          return `\n\n${inline(node).trim()}\n\n`;
        case 'BR': return '  \n';
        case 'HR': return '\n\n---\n\n';
        case 'STRONG': case 'B': { const t = inner(); return t ? `**${t}**` : ''; }
        case 'EM': case 'I': { const t = inner(); return t ? `_${t}_` : ''; }
        case 'CODE': return node.closest('pre') ? node.textContent : `\`${node.textContent}\``;
        case 'PRE': return `\n\n\`\`\`\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`;
        case 'BLOCKQUOTE': return `\n\n${inner().split('\n').map(l => `> ${l}`).join('\n')}\n\n`;
        case 'A': { const t = inner(); const h = node.getAttribute('href'); return h && t ? `[${t}](${abs(h)})` : t; }
        case 'IMG': { const src = node.getAttribute('src'); return src ? `![${node.getAttribute('alt') || ''}](${abs(src)})` : ''; }
        case 'UL': case 'OL': {
          const items = [...node.children].filter(c => c.tagName === 'LI');
          return `\n\n${items.map((li, i) => `${tag === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim()}`).join('\n')}\n\n`;
        }
        case 'LI': return `- ${inner()}\n`;
        default: return inline(node);
      }
    }
    return walk(fragment).replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── Find in page ─────────────────────────────────────────────────────
  let findState = { query: '', ranges: [], index: -1 };
  function find(query, step) {
    if (query !== findState.query) {
      findState = { query, ranges: [], index: -1 };
      if (query) {
        const index = buildIndex();
        const hay = index.text.toLowerCase();
        const needle = query.toLowerCase();
        for (let at = hay.indexOf(needle); at !== -1 && findState.ranges.length < 1000; at = hay.indexOf(needle, at + needle.length)) {
          const s = locate(index, at);
          const e = locate(index, at + needle.length);
          if (!s || !e) continue;
          try {
            const r = document.createRange();
            r.setStart(s.node, s.offset);
            r.setEnd(e.node, e.offset);
            findState.ranges.push(r);
          } catch { /* skip */ }
        }
      }
    }
    const { ranges } = findState;
    if (supported) {
      registry.find.clear();
      registry.findCurrent.clear();
      for (const r of ranges) registry.find.add(r);
    }
    if (!ranges.length) return { count: 0, index: 0 };
    findState.index = findState.index < 0 ? 0 : (findState.index + (step || 0) + ranges.length) % ranges.length;
    const current = ranges[findState.index];
    if (supported) registry.findCurrent.add(current);
    current.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    return { count: ranges.length, index: findState.index + 1 };
  }
  function clearFind() {
    findState = { query: '', ranges: [], index: -1 };
    if (supported) { registry.find.clear(); registry.findCurrent.clear(); }
  }

  // ── Dark mode for this site ──────────────────────────────────────────
  // Invert the page, then invert media back so photos and video look right.
  let darkStyle = null;
  function setDark(on) {
    if (on && !darkStyle) {
      darkStyle = document.createElement('style');
      darkStyle.textContent = `
        html { filter: invert(0.9) hue-rotate(180deg) !important; background: #fff !important; }
        img, video, picture, canvas, iframe, embed, object, svg image,
        [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }`;
      (document.head || document.documentElement).appendChild(darkStyle);
    } else if (!on && darkStyle) {
      darkStyle.remove();
      darkStyle = null;
    }
    return !!darkStyle;
  }

  // ── Browser shortcuts while the page has focus ───────────────────────
  // Keys typed in the page never reach CoolDesk's document, so forward the
  // tab/navigation combos. In text fields ⌘[ / ⌘] are left alone (editors
  // use them for indent).
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const editable = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    let key = null;
    if (e.ctrlKey && k === 'tab') key = e.shiftKey ? 'prev-tab' : 'next-tab';
    else if (e.shiftKey && (k === ']' || k === '}')) key = 'next-tab';
    else if (e.shiftKey && (k === '[' || k === '{')) key = 'prev-tab';
    else if (!e.shiftKey && !e.altKey && ['t', 'l', 'r', 'f'].includes(k)) key = `mod+${k}`;
    else if (!e.shiftKey && !e.altKey && !editable && (k === '[' || k === ']')) key = `mod+${k}`;
    else if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(k)) key = `tab-${k}`;
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'shortcut', key });
  }, true);

  // ── API for the app (called via evaluateJavaScript in this world) ────
  window.__cdTools = {
    /** Replace all highlights with the stored list for this page. */
    apply(list) {
      marks.clear();
      for (const h of list || []) marks.set(h.id, { color: h.color, note: h.note || '', quote: h.quote, range: null });
      reanchor(true);
      return [...marks.values()].filter(m => m.range).length;
    },
    /** Scroll to a highlight and flash it. */
    focus(id) {
      const m = marks.get(id);
      if (!m?.range) return false;
      const el = m.range.startContainer.parentElement;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (supported) {
        registry.focus.clear();
        registry.focus.add(m.range);
        setTimeout(() => registry.focus.clear(), 1400);
      }
      return true;
    },
    /** Find `query`; `step` 1/-1 moves between matches. → JSON {count, index} */
    find(query, step) { return JSON.stringify(find(String(query || ''), step)); },
    clearFind() { clearFind(); return true; },
    setDark(on) { return setDark(!!on); },
  };

  // Ask for this page's saved highlights — now, and again when an SPA
  // changes the URL without a reload.
  post({ type: 'ready' });
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      post({ type: 'ready' });
    }
  }, 1000);
})();
