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
        className="toggle-btn" style={{ marginTop: '15px' }}
        onClick={() => setShowAll(!showAll)}
      >
        {showAll ? 'Less' : 'More'}
      </button>

      <style jsx>{`
        .command-help {
          flex: 0 0 auto;
          width: clamp(220px, 26vw, 280px);
          max-width: 280px;
          min-width: 220px;
          padding: 16px;
          margin-left: 16px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          max-height: 600px;
          overflow-y: auto;
          backdrop-filter: blur(20px);
        }

        .command-help::-webkit-scrollbar {
          width: 6px;
        }

        .command-help::-webkit-scrollbar-track {
          background: transparent;
        }

        .command-help::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }

        .command-help::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .help-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .help-icon {
          color: #fbbf24;
          font-size: 18px;
          filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.3));
        }

        .help-title {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          font-size: 17px;
          letter-spacing: -0.3px;
        }

        .command-list { 
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: all 0.3s ease;
        }

        .command-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 14px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: default;
        }

        .command-item:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
          transform: translateX(2px);
        }

        .command-icon {
          color: #7c3aed;
          min-width: 20px;
          margin-top: 1px;
          font-size: 16px;
          filter: drop-shadow(0 0 6px rgba(124, 58, 237, 0.2));
        }

        .command-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
          flex: 1;
        }

        .command-text {
          font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
          font-weight: 600;
          font-size: 13px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.95);
          letter-spacing: -0.2px;
        }

        .command-meta {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 2px;
        }

        .command-desc {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          line-height: 1.4;
          letter-spacing: -0.1px;
        }

        .command-related,
        .command-eg {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
          font-size: 11px;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.2);
          color: rgba(96, 165, 250, 0.9);
          padding: 4px 8px;
          border-radius: 6px;
          width: fit-content;
          line-height: 1.3;
          letter-spacing: -0.1px;
        }

        .command-eg {
          background: rgba(52, 199, 89, 0.1);
          border-color: rgba(52, 199, 89, 0.2);
          color: rgba(52, 211, 153, 0.9);
        }

        .toggle-btn {
          margin-top: 16px;
          width: 100%;
          padding: 10px 16px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.8);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
          font-weight: 600;
          font-size: 13px;
          letter-spacing: -0.2px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .toggle-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.95);
          transform: translateY(-1px);
        }

        .toggle-btn:active {
          transform: translateY(0);
          background: rgba(255, 255, 255, 0.06);
        }

        .toggle-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.3);
          border-color: rgba(124, 58, 237, 0.5);
        }
  
        @media (max-width: 768px) {
          .command-help {
            padding: 16px;
            margin-left: 0;
            margin-top: 16px;
            width: 100%;
            max-height: 400px;
          }
        }
      `}</style>
    </div>
  );
}
