import {
  faArrowDown,
  faArrowLeft,
  faBoxOpen,
  faHashtag, faLightbulb,
  faPlus
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react';

export default function VoiceNavigationHelp() {
  const [showAll, setShowAll] = useState(false);

  // All commands
  const commands = [
    { icon: faHashtag, text: '"show numbers"', desc: 'mark clickable elements', related_command: 'hide numbers, click [num]' },
    { icon: faBoxOpen, text: '"open [query]"', desc: 'open in new tab', related_command: 'close tab, search for [query]', eg: "open google" },
    { icon: faPlus, text: '"search tab [query]"', desc: 'search in tabs', eg: "search tab google, find tab google" },
    { icon: faArrowDown, text: '"scroll down"', desc: 'scroll page down', related_command: 'scroll up' },
    { icon: faArrowLeft, text: "go back", desc: "go back", related_command: "go forward" },

  ];

  const visibleCommands = showAll ? commands : commands.slice(0, 4);

  return (
    <div className="command-help">
      <div className="help-header">
        <FontAwesomeIcon icon={faLightbulb} className="help-icon" />
        <span className="help-title">Voice Commands</span>
      </div>

      <div className="command-list">
        {visibleCommands.map((cmd, index) => (
          <div key={index} className="command-item">
            <FontAwesomeIcon icon={cmd.icon} className="command-icon" />
            <div className="command-content">
              <span className="command-text">{cmd.text}</span>
              <div className="command-meta">
                <span className="command-desc">{cmd.desc}</span>
                {cmd.related_command && (
                  <span className="command-related">Related: {cmd.related_command}</span>
                )}
                {cmd.eg && (
                  <span className="command-eg">Example: {cmd.eg}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        className="toggle-btn"
        onClick={() => setShowAll(!showAll)}
      >
        {showAll ? 'Show Less' : 'Show All Commands'}
      </button>

      <style jsx>{`
        .command-help {
          flex: 0 0 auto;
          width: clamp(200px, 24vw, 240px);
          max-width: 240px;
          min-width: 200px;
          padding-left: 8px;
          margin-left: 8px;
          border-left: none;
          max-height: 600px;
          overflow-y: auto;
        }
        .help-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-secondary, rgba(255,255,255,0.12));
          position: sticky;
          top: 0;
          background: var(--glass-bg, rgba(15, 21, 34, 0.95));
          z-index: 10;
        }
        .help-icon {
          color: var(--accent-warning, #fbbf24);
          font-size: 16px;
        }
        .help-title {
          font-weight: 600;
          color: var(--text-primary, #fff);
          font-size: 16px;
        }
        .command-list { 
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: all 0.3s ease;
        }
        /* Container and basic alignment */
.command-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px; 
  transition: background 0.15s ease;
}
.command-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

/* Icon a touch larger for balance */
.command-icon {
  color: #6366f1;              /* indigo-500 */
  min-width: 18px;
  margin-top: 2px;
  font-size: 14px;             /* was default; bump for visibility */
}

/* Make the command label bigger and brighter */
.command-text {
  font-weight: 700;            /* bolder */
  font-size: 14px;             /* was smaller; increase size */
  line-height: 1.25;
  color: var(--text-primary, #fff);  /* better contrast on dark bg */
}
/* Content column next to the icon */
.command-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Meta section under the main command text */
.command-meta {
  display: none;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

/* Reveal meta only on hover */
.command-item:hover .command-meta {
  display: flex;
}

/* Stack meta lines under the main text and align with it */
.command-desc,
.command-related {
  display: block;
  line-height: 1.25;
}

/* Description line */
.command-desc {
  color: #6b7280;              /* gray-500 */
  font-size: 14px;             /* Increased for readability */
  line-height: 1.3;
  margin-top: 2px;
}

  /* Related command pill */
.command-related {
  font-size: 14px;             /* Increased for readability */
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.25);
  padding: 3px 10px;           /* slightly larger touch target */
  width: fit-content;
  margin-top: 4px;
}
  }

  /* Toggle button styling */
  .toggle-btn {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 10px;
    background: linear-gradient(
      180deg,
      rgba(52, 199, 89, 0.18) 0%,
      rgba(52, 199, 89, 0.12) 100%
    );
    border: 1px solid rgba(52, 199, 89, 0.35);
    color: var(--accent-primary, #34c759);
    font-weight: 700;
    font-size: 12.5px;
    letter-spacing: 0.2px;
    cursor: pointer;
    transition: all 0.2s ease;
    backdrop-filter: blur(6px);
  }

  .toggle-btn:hover {
    background: linear-gradient(
      180deg,
      rgba(52, 199, 89, 0.26) 0%,
      rgba(52, 199, 89, 0.18) 100%
    );
    border-color: rgba(52, 199, 89, 0.5);
    transform: translateY(-1px);
  }

  .toggle-btn:active {
    transform: translateY(0);
    background: rgba(52, 199, 89, 0.22);
  }

  .toggle-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(52, 199, 89, 0.25);
    border-color: rgba(52, 199, 89, 0.6);
  }
  
        @media (max-width: 768px) {
          .command-help {
            padding-left: 0;
            margin-left: 0;
            border-top: 1px solid var(--border-primary, rgba(255,255,255,0.1));
            padding-top: 12px;
            width: 100%;
            max-height: 400px;
          }
        }
      `}</style>
    </div>
  );
}
