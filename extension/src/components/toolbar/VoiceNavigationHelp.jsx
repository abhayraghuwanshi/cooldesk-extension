import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faArrowDown, 
  faArrowLeft, 
  faArrowRight, 
  faArrowUp, 
  faExchangeAlt, 
  faHashtag, 
  faLightbulb, 
  faPlay, 
  faPause,
  faPlus, 
  faRedo, 
  faSearch, 
  faTimes 
} from '@fortawesome/free-solid-svg-icons';

export default function VoiceNavigationHelp() {
  return (
    <div className="command-help">
      <div className="help-header">
        <FontAwesomeIcon icon={faLightbulb} className="help-icon" />
        <span className="help-title">Voice Commands</span>
      </div>

      <div className="command-list">
        {/* Element Interaction */}
        <div className="command-category">Element Interaction</div>
        <div className="command-item">
          <FontAwesomeIcon icon={faHashtag} className="command-icon" />
          <span className="command-text">"show numbers"</span> → <span className="command-desc">mark clickable elements</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faHashtag} className="command-icon" />
          <span className="command-text">"hide numbers"</span> → <span className="command-desc">clear element markers</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faHashtag} className="command-icon" />
          <span className="command-text">"click 3"</span> → <span className="command-desc">click numbered element</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faHashtag} className="command-icon" />
          <span className="command-text">"click on [text]"</span> → <span className="command-desc">click element by text</span>
        </div>

        {/* Tab Management */}
        <div className="command-category">Tab Management</div>
        <div className="command-item">
          <FontAwesomeIcon icon={faExchangeAlt} className="command-icon" />
          <span className="command-text">"switch to tab 2"</span> → <span className="command-desc">switch to tab by number</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faExchangeAlt} className="command-icon" />
          <span className="command-text">"next tab"</span> → <span className="command-desc">go to next tab</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faExchangeAlt} className="command-icon" />
          <span className="command-text">"previous tab"</span> → <span className="command-desc">go to previous tab</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faPlus} className="command-icon" />
          <span className="command-text">"new tab"</span> → <span className="command-desc">create new tab</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faTimes} className="command-icon" />
          <span className="command-text">"close tab"</span> → <span className="command-desc">close current tab</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faSearch} className="command-icon" />
          <span className="command-text">"find tab [name]"</span> → <span className="command-desc">search and switch to tab</span>
        </div>

        {/* Search & Open */}
        <div className="command-category">Search & Open</div>
        <div className="command-item">
          <FontAwesomeIcon icon={faSearch} className="command-icon" />
          <span className="command-text">"search for [query]"</span> → <span className="command-desc">google search</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faExchangeAlt} className="command-icon" />
          <span className="command-text">"open [site]"</span> → <span className="command-desc">open from workspace</span>
        </div>

        {/* Page Navigation */}
        <div className="command-category">Page Navigation</div>
        <div className="command-item">
          <FontAwesomeIcon icon={faArrowDown} className="command-icon" />
          <span className="command-text">"scroll down"</span> → <span className="command-desc">scroll page down</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faArrowUp} className="command-icon" />
          <span className="command-text">"scroll up"</span> → <span className="command-desc">scroll page up</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faArrowLeft} className="command-icon" />
          <span className="command-text">"go back"</span> → <span className="command-desc">navigate back</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faArrowRight} className="command-icon" />
          <span className="command-text">"go forward"</span> → <span className="command-desc">navigate forward</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faRedo} className="command-icon" />
          <span className="command-text">"reload" / "refresh"</span> → <span className="command-desc">reload page</span>
        </div>

        {/* Media Controls */}
        <div className="command-category">Media Controls</div>
        <div className="command-item">
          <FontAwesomeIcon icon={faPlay} className="command-icon" />
          <span className="command-text">"play"</span> → <span className="command-desc">play media</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faPause} className="command-icon" />
          <span className="command-text">"pause"</span> → <span className="command-desc">pause media</span>
        </div>
        <div className="command-item">
          <FontAwesomeIcon icon={faPlay} className="command-icon" />
          <span className="command-text">"spacebar"</span> → <span className="command-desc">toggle play/pause</span>
        </div>
      </div>

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
        }
        .command-category {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent-primary, #34c759);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 12px;
          margin-bottom: 4px;
          padding-left: 4px;
          border-left: 2px solid var(--accent-primary, #34c759);
        }
        .command-category:first-child {
          margin-top: 0;
        }
        .command-item { 
          display: grid;
          grid-template-columns: 18px 1fr;
          align-items: start;
          column-gap: 8px;
          row-gap: 2px;
          color: var(--text, #e5e7eb); 
          font-size: 12px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-secondary, rgba(255,255,255,0.08));
          border-radius: 8px;
          transition: all 0.2s ease;
          line-height: 1.25;
        }
        .command-item:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: var(--border-accent, rgba(52, 199, 89, 0.3));
          transform: translateX(2px);
        }
        .command-icon { 
          width: 16px; 
          opacity: 0.9;
          color: var(--accent-blue, #60a5fa);
          grid-column: 1 / 2;
          grid-row: 1 / 3;
        }
        .command-text { 
          font-weight: 600;
          color: var(--accent-primary, #34c759);
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          font-size: 11px;
          display: inline;
        }
        .command-desc { 
          opacity: 0.8;
          color: var(--text-secondary, #9ca3af);
          font-size: 10.5px;
          display: block;
          margin-top: 2px;
        }

        @media (max-width: 768px) {
          .command-help {
            padding-left: 0;
            margin-left: 0;
            border-left: none;
            border-top: 1px solid var(--border-primary, rgba(255,255,255,0.1));
            padding-top: 12px;
            width: 100%;
            max-height: 400px;
          }
        }

        @media (max-width: 600px) {
          .command-item {
            grid-template-columns: 16px 1fr;
            padding: 4px 6px;
            font-size: 11px;
          }
          .command-text {
            font-size: 10px;
          }
          .command-desc {
            font-size: 9.5px;
          }
          .command-category {
            font-size: 10px;
            margin-top: 8px;
          }
        }
      `}</style>
    </div>
  );
}
