import { faPlus, faThumbTack, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useState, useEffect } from "react";

import "./../../styles/default/SimpleBoard.css";

export function GlassNoticeBoard({ hideNoticeBoard = false }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('glassNoticeBoard_collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('glassNoticeBoard_collapsed', String(isCollapsed));
    } catch (e) {
      console.warn('[GlassNoticeBoard] Failed to save collapsed state', e);
    }
  }, [isCollapsed]);

  // Return null if hidden via display settings
  if (hideNoticeBoard) {
    return null;
  }

  const addNote = () => {
    if (!text.trim()) return;

    const newNote = {
      id: Date.now(),
      text: text.trim(),
      createdAt: Date.now(),
      color: pickRandomColor(),
      pinned: false
    };

    setItems([newNote, ...items]);
    setText("");
  };

  const pickRandomColor = () => {
    const colors = [
      "#FFF6B2", // warm yellow
      "#FFE7C1", // peach
      "#FFDEE2", // rose
      "#DFF4FF", // soft blue
      "#D9F7E5"  // mint
    ];

    return colors[Math.floor(Math.random() * colors.length)];
  };

  const deleteNote = (id) => setItems(items.filter(n => n.id !== id));

  const togglePin = (id) =>
    setItems(
      items.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n)
    );

  const formatAge = (ts) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return mins + "m";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h";
    const days = Math.floor(hrs / 24);
    return days + "d";
  };

  const pinned = items.filter(n => n.pinned);
  const normal = items.filter(n => !n.pinned);

  // If collapsed, show only title
  if (isCollapsed) {
    return (
      <div
        onClick={() => setIsCollapsed(false)}
        style={{
          marginBottom: 'var(--section-spacing)',
          padding: '12px 20px',
          border: '1px solid rgba(70, 70, 75, 0.7)',
          borderRadius: '16px',
          background: 'rgba(28, 28, 33, 0.45)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(28, 28, 33, 0.65)';
          e.currentTarget.style.borderColor = 'rgba(100, 100, 105, 0.7)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(28, 28, 33, 0.45)';
          e.currentTarget.style.borderColor = 'rgba(70, 70, 75, 0.7)';
        }}
      >
        <h3 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 600,
          margin: 0,
          color: '#ffffff',
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          Notice Board
        </h3>
        <span style={{
          fontSize: '0.85rem',
          opacity: 0.5,
          color: 'var(--text-secondary, #aaa)'
        }}>
          Click to expand
        </span>
      </div>
    );
  }

  return (
    <div className="sticky-board-root">

      <h3
        className="sticky-board-title"
        onClick={() => setIsCollapsed(true)}
        style={{
          cursor: 'pointer',
          transition: 'opacity 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.7';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        title="Click to hide"
      >
        Notice Board
      </h3>

      {/* Input */}
      <div className="sticky-board-input-row">
        <input
          className="sticky-board-input"
          placeholder="Write a note..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="sticky-board-add-btn" onClick={addNote}>
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      {/* Grid Container */}
      <div className="sticky-board-grid">

        {/* Pinned */}
        {pinned.map(note => (
          <StickyCard
            key={note.id}
            note={note}
            formatAge={formatAge}
            deleteNote={deleteNote}
            togglePin={togglePin}
          />
        ))}

        {/* Normal */}
        {normal.map(note => (
          <StickyCard
            key={note.id}
            note={note}
            formatAge={formatAge}
            deleteNote={deleteNote}
            togglePin={togglePin}
          />
        ))}
      </div>
    </div>
  );
}

function StickyCard({ note, formatAge, deleteNote, togglePin }) {
  return (
    <div className="sticky-card" style={{ "--sticky-color": note.color }}>
      <div className="sticky-card-text">{note.text}</div>

      <div className="sticky-card-meta">
        <span className="sticky-card-age">{formatAge(note.createdAt)}</span>

        <button className="sticky-btn" onClick={() => togglePin(note.id)}>
          <FontAwesomeIcon icon={faThumbTack} />
        </button>

        <button className="sticky-btn sticky-delete" onClick={() => deleteNote(note.id)}>
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </div>
    </div>
  );
}
