import { faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useEffect, useMemo, useRef, useState } from 'react';

// A lightweight tip component that periodically shows a random voice command
// Usage: <RandomVoiceCommandTip />
// Props:
// - commands: optional array of { text: string, desc: string }
// - intervalMs: number (default 8000)
// - pauseOnHover: boolean (default true)
export default function RandomVoiceCommandTip({ commands, intervalMs = 8000, pauseOnHover = true }) {
  const defaultCommands = useMemo(() => (
    [
      { text: '"show numbers"', desc: 'mark clickable elements' },
      { text: '"hide numbers"', desc: 'clear element markers' },
      { text: '"click 3"', desc: 'click numbered element' },
      { text: '"click on Play"', desc: 'click element by text' },
      { text: '"switch to tab 2"', desc: 'switch to tab by number' },
      { text: '"next tab"', desc: 'go to next tab' },
      { text: '"previous tab"', desc: 'go to previous tab' },
      { text: '"new tab"', desc: 'create new tab' },
      { text: '"close tab"', desc: 'close current tab' },
      { text: '"find tab gmail"', desc: 'search and switch to tab' },
      { text: '"search for cats"', desc: 'google search' },
      { text: '"scroll down"', desc: 'scroll page down' },
      { text: '"scroll up"', desc: 'scroll page up' },
      { text: '"go back"', desc: 'navigate back' },
      { text: '"reload"', desc: 'reload page' },
      { text: '"spacebar"', desc: 'toggle play/pause' },
      { text: '"add note: remember to check email"', desc: 'add a note with context' },
      { text: '"add todo: review project proposal"', desc: 'create a todo item' },
      { text: '"save url to workspace"', desc: 'save current page to workspace' },
      { text: '"pin this page"', desc: 'add current page to pins' }
    ]
  ), []);

  const list = (commands && Array.isArray(commands) && commands.length > 0) ? commands : defaultCommands;

  const [index, setIndex] = useState(() => Math.floor(Math.random() * list.length));
  const timerRef = useRef(null);
  const hoveringRef = useRef(false);

  const pickNext = () => {
    setIndex((prev) => {
      let next = Math.floor(Math.random() * list.length);
      if (next === prev && list.length > 1) {
        next = (prev + 1) % list.length;
      }
      return next;
    });
  };

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (pauseOnHover && hoveringRef.current) return;
      pickNext();
    }, Math.max(2500, intervalMs));
    return () => timerRef.current && clearInterval(timerRef.current);
  }, [intervalMs, pauseOnHover, list.length]);

  const tip = list[index] || defaultCommands[0];

  return (
    <div
      className="random-voice-tip"
      onMouseEnter={() => { if (pauseOnHover) hoveringRef.current = true; }}
      onMouseLeave={() => { if (pauseOnHover) hoveringRef.current = false; }}
      title="Try saying this command"
    >
      <FontAwesomeIcon icon={faLightbulb} className="tip-icon" />
      <div className="tip-content">
        <div className="tip-command">{tip.text}</div>
        <div className="tip-desc">{tip.desc}</div>
      </div>
      <style jsx>{`
        .random-voice-tip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 10px rgba(0,0,0,0.15);
          backdrop-filter: blur(10px);
          transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
          cursor: default;
          max-width: 320px;
        }
        .random-voice-tip:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(52, 199, 89, 0.25);
        }
        .tip-icon {
          color: var(--accent-warning, #fbbf24);
          font-size: 14px;
          flex-shrink: 0;
        }
        .tip-content { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .tip-command {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          font-size: 12px;
          font-weight: 700;
          color: var(--accent-primary, #34c759);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tip-desc {
          font-size: 11px;
          color: var(--text-secondary, #9ca3af);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (max-width: 600px) {
          .random-voice-tip { max-width: 260px; padding: 5px 8px; }
          .tip-command { font-size: 11px; }
          .tip-desc { font-size: 10px; }
        }
      `}</style>
    </div>
  );
}
