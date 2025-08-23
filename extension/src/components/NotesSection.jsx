import { faPlus, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';
import { deleteNote as dbDeleteNote, listNotes as dbListNotes, upsertNote as dbUpsertNote } from '../db';

export function NotesSection() {
  const [notes, setNotes] = React.useState([]);
  const [text, setText] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [editText, setEditText] = React.useState('');

  const loadNotes = React.useCallback(async () => {
    try {
      const list = await dbListNotes();
      setNotes(Array.isArray(list) ? list : []);
    } catch { setNotes([]); }
  }, []);

  const addNote = React.useCallback(async () => {
    const t = (text || '').trim();
    if (!t) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const note = { id, text: t, createdAt: Date.now() };
    try { await dbUpsertNote(note); } catch { }
    setText('');
    // Reload to reflect authoritative DB ordering and cap
    await loadNotes();
  }, [text, loadNotes]);

  const removeNote = React.useCallback(async (id) => {
    try { await dbDeleteNote(id); } catch { }
    await loadNotes();
  }, [loadNotes]);

  const startEdit = React.useCallback((n) => {
    setEditingId(n.id);
    setEditText(n.text || '');
  }, []);

  const saveEdit = React.useCallback(async () => {
    const t = (editText || '').trim();
    if (!editingId) return setEditingId(null);
    const existing = notes.find(n => n.id === editingId) || { id: editingId, createdAt: Date.now() };
    const updated = { ...existing, text: t };
    try { await dbUpsertNote(updated); } catch { }
    await loadNotes();
    setEditingId(null);
    setEditText('');
  }, [editText, editingId, notes, loadNotes]);

  const cancelEdit = React.useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  React.useEffect(() => { loadNotes(); }, [loadNotes]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ marginBottom: '10px' }}>
          <FontAwesomeIcon icon={faPen} style={{ marginRight: 6 }} />
          Hot Thoughts
        </h3>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
          placeholder="Write a quick note..."
          style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid #273043', background: '#0f1724', color: '#e5e7eb', fontSize: 13 }}
        />
        <button
          onClick={addNote}
          className="icon-btn"
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #273043', background: '#1b2331', color: '#e5e7eb', fontSize: 13 }}
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {notes.length === 0 && (
          <div className="empty">No notes yet</div>
        )}
        {notes.map(n => (
          <div key={n.id} className="activity-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #273043', borderRadius: 10, background: '#0f1724' }}>
            {editingId === n.id ? (
              <>
                <input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                  autoFocus
                  style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #273043', background: '#0f1724', color: '#e5e7eb', fontSize: 13 }}
                />
                <button onClick={saveEdit} className="icon-btn" style={{ width: 60, height: 28 }}>Save</button>
                <button onClick={cancelEdit} className="icon-btn" style={{ width: 70, height: 28 }}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="activity-card__title" style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {n.text}
                  </div>
                  <div className="activity-card__meta" style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                  </div>
                </div>
                <button onClick={() => startEdit(n)} className="icon-btn" title="Edit" style={{ width: 28, height: 28 }}>
                  <FontAwesomeIcon icon={faPen} />
                </button>
                <button onClick={() => removeNote(n.id)} className="icon-btn" title="Delete" style={{ width: 28, height: 28 }}>
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
