import {
  faArrowDown,
  faArrowLeft,
  faBoxOpen,
  faHashtag,
  faLightbulb,
  faPlus
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';

// --- Component Data ---
// 1. Data moved outside the component: This array is now a static 'const'.
//    It avoids being re-declared on every render, which is more performant.
// 2. UX Copywriting: Refined 'desc' for clarity (e.g., "go back" description).
const commands = [
  { icon: faHashtag, text: '"show numbers"', desc: 'Mark all clickable items', related_command: 'hide numbers, click [num]' },
  { icon: faBoxOpen, text: '"open [query]"', desc: 'Open a site in a new tab', related_command: 'close tab, search for [query]', eg: "open google" },
  { icon: faPlus, text: '"search tab [query]"', desc: 'Search through open tabs', eg: "search tab google, find tab google" },
  { icon: faArrowDown, text: '"scroll down"', desc: 'Scroll the page down', related_command: 'scroll up' },
  { icon: faArrowLeft, text: '"go back"', desc: 'Navigate to the previous page', related_command: 'go forward' },
  // Add more commands here as needed
];

// --- Constants ---
// Define constants here for easy tweaking and clear intent.
const DEFAULT_VISIBLE_COUNT = 4;


export default function VoiceNavigationHelp() {
  const [showAll, setShowAll] = useState(false);

  // --- Derived State & Logic ---
  // This logic is more robust. The "More" button will only appear if
  // there are actually more commands to show.
  const canToggle = commands.length > DEFAULT_VISIBLE_COUNT;
  const visibleCommands = showAll ? commands : commands.slice(0, DEFAULT_VISIBLE_COUNT);

  return (
    // 'role' and 'aria-labelledby' improve semantics for screen readers.
    <div className="command-help" role="complementary" aria-labelledby="help-title">
      <div className="help-header">
        <FontAwesomeIcon icon={faLightbulb} className="help-icon" aria-hidden="true" />
        <span className="help-title" id="help-title">Voice Commands</span>
      </div>

      {/* 'aria-live="polite"' would announce changes, but 'list' is fine here. */}
      <div className="command-list">
        {visibleCommands.map((cmd, index) => (
          <div
            key={index}
            className="command-item"
            // UX: This custom property enables staggered animations via pure CSS.
            style={{ '--index': index }}
          >
            {/* A11y: Decorative icons are hidden from screen readers. */}
            <FontAwesomeIcon icon={cmd.icon} className="command-icon" aria-hidden="true" />
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

      {/* --- Conditional Toggle Button --- */}
      {/* Only render the button if toggling is possible. */}
      {canToggle && (
        <button
          className="toggle-btn"
          onClick={() => setShowAll(!showAll)}
          // A11y: Informs screen readers whether the content is expanded or not.
          aria-expanded={showAll}
        >
          {showAll ? 'Show Less' : `Show All (${commands.length})`}
        </button>
      )}

      {/* --- Styles --- */}
      {/*
        Key UI/UX Style Improvements:
        1. Removed 'transition' from '.command-list' (it wasn't doing anything).
        2. Added a keyframe animation 'fadeInUp' for a polished, staggered load-in.
        3. Ensured 'focus-visible' state is styled for keyboard accessibility.
      */}
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

        /* --- Scrollbar Styling --- */
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

        /* --- Header --- */
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

        /* --- Command List --- */
        .command-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
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

          /* UX: Staggered animation for items loading in */
          opacity: 0;
          transform: translateY(4px);
          animation: fadeInUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          /* The delay is set by the inline 'style' attribute */
          animation-delay: calc(var(--index) * 50ms);
        }
        
        @keyframes fadeInUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
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

        /* --- Toggle Button --- */
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

        /* A11y: Clear focus state for keyboard navigation */
        .toggle-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.3);
          border-color: rgba(124, 58, 237, 0.5);
        }
        
        /* --- Responsive --- */
        @media (max-width: 768px) {
          .command-help {
            padding: 16px;
            margin-left: 0;
            margin-top: 16px;
            width: 100%;
            /* UX: Increased max-height for mobile where vertical 
              space is more available. 
            */
            max-height: 50vh; 
          }
        }
      `}</style>
    </div>
  );
}