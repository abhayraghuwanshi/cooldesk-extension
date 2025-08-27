// URL-based notes database operations
import { openDB } from './index.js';

const URL_NOTES_STORE = 'urlNotes';

// Get all notes for a specific URL
export async function getUrlNotes(url) {
  try {
    const db = await openDB();
    const tx = db.transaction([URL_NOTES_STORE], 'readonly');
    const store = tx.objectStore(URL_NOTES_STORE);
    const index = store.index('url');
    const notes = await index.getAll(url);
    await tx.complete;
    
    // Sort by creation date, newest first
    return notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (error) {
    console.error('Failed to get URL notes:', error);
    return [];
  }
}

// Save a note for a specific URL
export async function saveUrlNote(note) {
  try {
    const db = await openDB();
    const tx = db.transaction([URL_NOTES_STORE], 'readwrite');
    const store = tx.objectStore(URL_NOTES_STORE);
    await store.add(note);
    await tx.complete;
    return note;
  } catch (error) {
    console.error('Failed to save URL note:', error);
    throw error;
  }
}

// Update an existing URL note
export async function updateUrlNote(note) {
  try {
    const db = await openDB();
    const tx = db.transaction([URL_NOTES_STORE], 'readwrite');
    const store = tx.objectStore(URL_NOTES_STORE);
    await store.put(note);
    await tx.complete;
    return note;
  } catch (error) {
    console.error('Failed to update URL note:', error);
    throw error;
  }
}

// Delete a URL note
export async function deleteUrlNote(noteId) {
  try {
    const db = await openDB();
    const tx = db.transaction([URL_NOTES_STORE], 'readwrite');
    const store = tx.objectStore(URL_NOTES_STORE);
    await store.delete(noteId);
    await tx.complete;
  } catch (error) {
    console.error('Failed to delete URL note:', error);
    throw error;
  }
}

// Get all notes across all URLs (for search/overview)
export async function getAllUrlNotes() {
  try {
    const db = await openDB();
    const tx = db.transaction([URL_NOTES_STORE], 'readonly');
    const store = tx.objectStore(URL_NOTES_STORE);
    const notes = await store.getAll();
    await tx.complete;
    
    return notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (error) {
    console.error('Failed to get all URL notes:', error);
    return [];
  }
}

// Search notes by text content
export async function searchUrlNotes(query) {
  try {
    const allNotes = await getAllUrlNotes();
    const searchTerm = query.toLowerCase();
    
    return allNotes.filter(note => {
      const searchableText = [
        note.title,
        note.text,
        note.description,
        note.selectedText,
        note.url
      ].filter(Boolean).join(' ').toLowerCase();
      
      return searchableText.includes(searchTerm);
    });
  } catch (error) {
    console.error('Failed to search URL notes:', error);
    return [];
  }
}

// Get notes count for a URL
export async function getUrlNotesCount(url) {
  try {
    const notes = await getUrlNotes(url);
    return notes.length;
  } catch (error) {
    console.error('Failed to get URL notes count:', error);
    return 0;
  }
}

// Get recent notes across all URLs (for dashboard)
export async function getRecentUrlNotes(limit = 10) {
  try {
    const allNotes = await getAllUrlNotes();
    return allNotes.slice(0, limit);
  } catch (error) {
    console.error('Failed to get recent URL notes:', error);
    return [];
  }
}
