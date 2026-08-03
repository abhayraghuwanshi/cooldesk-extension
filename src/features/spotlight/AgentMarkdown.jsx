import { marked } from 'marked';
import { useMemo } from 'react';

/**
 * Render an agent's markdown reply.
 *
 * Parsed with `marked`, but rendered as React elements from its token stream
 * rather than through `marked.parse()` + `dangerouslySetInnerHTML`. That
 * matters here: the agent has web access, so its output can contain text
 * lifted from a page that anyone can publish, and this component renders
 * inside the app window where `window.__TAURI_INTERNALS__` lives. Injecting
 * that as HTML would turn a hostile page into script execution against the
 * user's machine. Going through the token stream means markup can only ever
 * become the elements enumerated below — there is no path from model output
 * to raw HTML.
 *
 * Links open in the real browser rather than navigating the launcher.
 */

const openExternal = (e, href) => {
  e.preventDefault();
  e.stopPropagation();
  if (!href) return;
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(href);
  else window.open(href, '_blank', 'noopener,noreferrer');
};

/** Inline tokens: bold, italics, code, links, line breaks. */
function Inline({ tokens }) {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong':
        return <strong key={i}><Inline tokens={t.tokens} /></strong>;
      case 'em':
        return <em key={i}><Inline tokens={t.tokens} /></em>;
      case 'del':
        return <del key={i}><Inline tokens={t.tokens} /></del>;
      case 'codespan':
        return <code key={i} className="agent-md-code">{t.text}</code>;
      case 'br':
        return <br key={i} />;
      case 'link':
        // Only http(s) becomes a link. A `javascript:` href is rendered as
        // plain text instead — the agent should never be able to author one,
        // but "should never" is not a control.
        return /^https?:\/\//i.test(t.href) ? (
          <a
            key={i}
            href={t.href}
            className="agent-md-link"
            title={t.href}
            onClick={(e) => openExternal(e, t.href)}
          >
            <Inline tokens={t.tokens} />
          </a>
        ) : (
          <span key={i}><Inline tokens={t.tokens} /></span>
        );
      case 'image':
        // Not rendered — a remote image is a tracking pixel with extra steps.
        return <span key={i} className="agent-md-muted">[image]</span>;
      case 'escape':
      case 'text':
      default:
        return t.tokens ? <Inline key={i} tokens={t.tokens} /> : <span key={i}>{t.raw ?? t.text}</span>;
    }
  });
}

/** Block tokens: paragraphs, lists, headings, code fences, quotes, rules. */
function Block({ tokens }) {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'heading':
        return <div key={i} className={`agent-md-h agent-md-h${Math.min(t.depth, 3)}`}><Inline tokens={t.tokens} /></div>;
      case 'paragraph':
        return <p key={i} className="agent-md-p"><Inline tokens={t.tokens} /></p>;
      case 'list': {
        const Tag = t.ordered ? 'ol' : 'ul';
        return (
          <Tag key={i} className="agent-md-list">
            {t.items.map((item, j) => (
              <li key={j}>
                {/* A list item's children are block tokens; the common case is
                    a single `text` token that carries its own inline tokens. */}
                {item.tokens?.length === 1 && item.tokens[0].type === 'text'
                  ? <Inline tokens={item.tokens[0].tokens} />
                  : <Block tokens={item.tokens} />}
              </li>
            ))}
          </Tag>
        );
      }
      case 'code':
        return <pre key={i} className="agent-md-pre"><code>{t.text}</code></pre>;
      case 'blockquote':
        return <blockquote key={i} className="agent-md-quote"><Block tokens={t.tokens} /></blockquote>;
      case 'hr':
        return <hr key={i} className="agent-md-hr" />;
      case 'space':
        return null;
      case 'html':
        // Raw HTML in the reply is shown as text, never parsed.
        return <p key={i} className="agent-md-p">{t.raw}</p>;
      case 'text':
        return <p key={i} className="agent-md-p">{t.tokens ? <Inline tokens={t.tokens} /> : t.text}</p>;
      default:
        return <p key={i} className="agent-md-p">{t.raw}</p>;
    }
  });
}

export function AgentMarkdown({ text }) {
  const tokens = useMemo(() => {
    if (!text) return [];
    try {
      return marked.lexer(text);
    } catch {
      return null; // fall back to plain text below
    }
  }, [text]);

  if (tokens === null) return <div className="agent-md-plain">{text}</div>;
  return <div className="agent-md"><Block tokens={tokens} /></div>;
}
