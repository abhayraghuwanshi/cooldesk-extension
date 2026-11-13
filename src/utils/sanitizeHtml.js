// Allowlist HTML sanitiser for content written by someone else (team notes)
// that has to be shown as rich text. The desktop app's main window can drive
// a terminal and read files, so script reaching it is a full takeover: keep
// only formatting tags and safe attributes, and only web / mail / data-image
// URLs. Everything else (script, style, iframe, form, event handlers,
// javascript: links) is dropped. Built on DOMParser, which parses without
// running scripts or loading resources.

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'div', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);

// Removed together with everything inside them (unwrapping would leak their
// text, e.g. a script's source, into the note).
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript',
  'template', 'svg', 'math', 'form', 'textarea', 'select', 'button', 'input',
  'link', 'meta', 'base', 'title', 'head',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);

function safeUrl(value, { image = false } = {}) {
  const v = String(value || '').trim();
  if (image && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) return v;
  try {
    const u = new URL(v, 'https://invalid.example/');
    if (u.origin === 'https://invalid.example') return null; // relative: no base to resolve against
    return ['http:', 'https:', ...(image ? [] : ['mailto:'])].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function clean(node, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown wrapper: keep its (cleaned) children, drop the element.
      clean(child, doc);
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) { child.removeAttribute(attr.name); continue; }
      if (name === 'href' || name === 'src') {
        const url = safeUrl(attr.value, { image: tag === 'img' && name === 'src' });
        if (url) child.setAttribute(name, url);
        else child.removeAttribute(attr.name);
      }
    }
    if (tag === 'a') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    clean(child, doc);
  }
}

/** HTML from an untrusted source → HTML that only formats text. */
export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body, doc);
  return doc.body.innerHTML;
}
