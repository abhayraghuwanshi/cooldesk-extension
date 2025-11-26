import { faPlus, faThumbTack, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useState } from "react";

import "./../../styles/default/SimpleBoard.css";

export function GlassNoticeBoard({ hideNoticeBoard = false }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");

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

  return (
    <div className="sticky-board-root">

      <h3 className="sticky-board-title">Notice Board</h3>

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
