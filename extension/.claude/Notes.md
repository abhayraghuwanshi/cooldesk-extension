# CoolDesk Extension - Notes System Documentation

## Overview

The CoolDesk Notes system is a comprehensive note-taking solution with rich text editing, voice input, folder organization, and team collaboration features. It supports multiple note types including workspace notes, URL-specific notes, and highlights.

---

## Architecture

```
Notes System
├── NotesCanvas (Main Container)
│   ├── Folder Sidebar
│   ├── Notes List (Grouped by Time)
│   └── TiptapEditor (Rich Text Editor)
├── NotesWidget (Quick Note Input)
├── SidebarNotes (Sidebar View)
└── Database Layer
    ├── Regular Notes Store
    ├── URL Notes Store
    └── Highlights Store
```

---

## Components

### 1. NotesCanvas (Main Notes Interface)

**Location:** [src/components/spatial/NotesCanvas.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/spatial/NotesCanvas.jsx)

#### Purpose
Full-featured notes interface with folder organization, rich text editing, voice input, and team sharing.

#### Key Features
- **Multiple Note Types**: Workspace notes, URL notes, highlights
- **Folder Organization**: Custom folders + special folders (Highlights, URL Notes, Shared with Me)
- **Time-based Grouping**: Pinned, Today, Yesterday, Previous 7/30 Days, This Year, Older
- **Rich Text Editor**: TiptapEditor with formatting, lists, headings
- **Voice Input**: Speech-to-text with Web Speech API
- **Auto-save**: Debounced auto-save (1 second delay)
- **Team Sharing**: Share notes with P2P teams
- **Search**: Filter notes by content
- **Default Guide Notes**: Onboarding notes for new users

#### Props

```javascript
{
  workspaceId: String  // Optional workspace context
}
```

#### Note Types

**1. Workspace Notes (Regular Notes)**
```javascript
{
  id: String,
  title: String,
  text: String,        // HTML content
  folder: String,      // Custom folder name
  type: 'richtext',
  pinned: Boolean,
  createdAt: Number,
  updatedAt: Number
}
```

**2. URL Notes**
```javascript
{
  id: String,
  url: String,         // Associated webpage URL
  title: String,
  text: String,
  folder: 'URL Notes',
  type: 'url',
  createdAt: Number,
  updatedAt: Number
}
```

**3. Highlights**
```javascript
{
  id: String,
  url: String,         // Source webpage
  text: String,        // Highlighted text
  title: String,
  folder: 'Highlights',
  type: 'highlight',
  isHighlight: true,
  createdAt: Number
}
```

#### Data Flow

```javascript
// Consolidated data loading (single DB query)
fetchAllData() {
  // Parallel fetch
  [regularNotes, urlNotes, settings] = await Promise.all([
    dbListNotes(),
    listAllUrlNotes(),
    getSettings()
  ]);
  
  // Categorize notes
  workspaceNotes = filter(regularNotes, isWorkspaceNote);
  urlNotesData = filter(regularNotes + urlNotes, isUrlNote);
  highlightsData = filter(regularNotes + urlNotes, isHighlight);
  
  // Update state
  setNotes(workspaceNotes);
  setUrlNotes(urlNotesData);
  setHighlights(highlightsData);
}
```

#### Auto-save System

```javascript
// Debounced auto-save (1 second)
triggerAutoSave(content) {
  setAutoSaveStatus('unsaved');
  clearTimeout(autoSaveTimeout);
  
  autoSaveTimeout = setTimeout(() => {
    saveNote(content, activeNote?.id);
  }, 1000);
}

// Auto-save status: 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'
```

#### Voice Input

```javascript
// Web Speech API integration
toggleRecording() {
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  
  recognition.onresult = (event) => {
    const transcript = event.results[i][0].transcript;
    editorRef.current.insertContent(transcript);
  };
  
  recognition.start();
}
```

#### Team Sharing

```javascript
// Share note with active team
handleShareNote() {
  await p2pStorage.addItemToTeam(activeTeam.id, {
    type: 'NOTE_SHARE',
    payload: noteToShare,
    timestamp: Date.now()
  });
}

// Receive shared notes
p2pStorage.subscribeToSharedItems(teamId, (newItems) => {
  // Import shared notes to "Shared with Me" folder
  const importedNote = {
    ...note,
    id: `${Date.now()}_shared_${random}`,
    title: `(Shared) ${note.title}`,
    folder: 'Shared with Me'
  };
  await dbUpsertNote(importedNote);
});
```

---

### 2. NotesWidget (Quick Note Input)

**Location:** [src/components/cooldesk/NotesWidget.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/cooldesk/NotesWidget.jsx)

#### Purpose
Lightweight quick note input widget for dashboard/overview.

#### Key Features
- **Voice Input**: Annyang library for speech recognition
- **Auto-save**: Saves on button click or Ctrl+Enter
- **Character Counter**: Shows character count
- **Event Broadcasting**: Dispatches `notes-updated` event

#### Props

```javascript
{
  maxNotes: Number,    // Max notes to display (default: 5)
  compact: Boolean     // Compact mode (default: false)
}
```

#### Usage Example

```jsx
<NotesWidget maxNotes={5} compact={false} />
```

#### Voice Input (Annyang)

```javascript
toggleVoice() {
  if (isListening) {
    annyang.abort();
  } else {
    annyang.start({ autoRestart: false, continuous: true });
    
    annyang.addCallback('result', (phrases) => {
      const transcript = phrases[0];
      setNewNoteText(prev => prev + ' ' + transcript);
    });
  }
}
```

#### Event System

```javascript
// Dispatch event after saving
window.dispatchEvent(new CustomEvent('notes-updated', { 
  detail: { note } 
}));

// Listen in other components
window.addEventListener('notes-updated', (e) => {
  refreshNotesList();
});
```

---

## Database Layer

### API Functions

**Location:** [src/db/unified-api.js](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/db/unified-api.js)

```javascript
// Regular Notes
await upsertNote(note);          // Create or update
await listNotes();               // List all notes
await deleteNote(noteId);        // Delete note

// URL Notes
await saveUrlNote(urlNote);      // Save URL-specific note
await listAllUrlNotes();         // List all URL notes
await deleteUrlNote(noteId);     // Delete URL note

// Highlights
// Stored as notes with type: 'highlight'
```

### Database Schema

**Notes Store (IndexedDB)**
```javascript
{
  storeName: 'notes',
  keyPath: 'id',
  indexes: [
    { name: 'folder', keyPath: 'folder' },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'updatedAt', keyPath: 'updatedAt' },
    { name: 'type', keyPath: 'type' }
  ]
}
```

**URL Notes Store**
```javascript
{
  storeName: 'urlNotes',
  keyPath: 'id',
  indexes: [
    { name: 'url', keyPath: 'url' },
    { name: 'createdAt', keyPath: 'createdAt' }
  ]
}
```

---

## Default Guide Notes

New users automatically receive 4 guide notes in the "Getting Started" folder:

1. **Welcome to CoolDesk** - Overview of features
2. **Workspaces & Tab Management** - Workspace features
3. **Highlights & URL Notes** - Text capture features
4. **Keyboard Shortcuts & Tips** - Productivity tips

```javascript
// Created on first load
const createDefaultNotes = async () => {
  if (allNotes.length === 0 && !settings?.defaultNotesCreated) {
    for (const note of DEFAULT_NOTES) {
      await dbUpsertNote(note);
    }
    await saveSettings({ defaultNotesCreated: true });
  }
};
```

---

## Folder System

### Special Folders

1. **All Notes** - Shows all workspace notes
2. **Highlights** - Text highlights from web pages
3. **URL Notes** - Notes attached to specific URLs
4. **Shared with Me** - Notes shared by team members

### Custom Folders

Users can create custom folders by typing a folder name when creating/editing notes.

### Folder Sorting

```javascript
folders.sort((a, b) => {
  // "All Notes" always first
  if (a === 'All Notes') return -1;
  
  // Special folders at bottom
  const specialFolders = ['Highlights', 'URL Notes'];
  if (specialFolders.includes(a)) return 1;
  
  // Alphabetical for custom folders
  return a.localeCompare(b);
});
```

---

## Time-based Grouping

Notes are grouped by recency (Apple Notes style):

```javascript
{
  'Pinned': [],           // Pinned notes (always on top)
  'Today': [],            // Created/updated today
  'Yesterday': [],        // Yesterday
  'Previous 7 Days': [],  // Last week
  'Previous 30 Days': [], // Last month
  'This Year': [],        // This year
  'Older': []            // Older than this year
}
```

---

## Rich Text Editor (TiptapEditor)

**Location:** [src/components/spatial/editor/TiptapEditor.jsx](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/spatial/editor/TiptapEditor.jsx)

### Features
- **Formatting**: Bold, Italic, Underline, Strike
- **Headings**: H1, H2, H3
- **Lists**: Bullet lists, Ordered lists, Task lists
- **Links**: Insert/edit links
- **Code**: Inline code, Code blocks
- **Undo/Redo**: Full history support

### Keyboard Shortcuts

```
Ctrl+B - Bold
Ctrl+I - Italic
Ctrl+U - Underline
Ctrl+Z - Undo
Ctrl+Shift+Z - Redo
Tab - Indent
Shift+Tab - Outdent
```

---

## Performance Optimizations

### 1. Consolidated Data Loading

```javascript
// Single query instead of 3 separate queries
const [regularNotes, urlNotes, settings] = await Promise.all([
  dbListNotes(),
  listAllUrlNotes(),
  getSettings()
]);
```

### 2. Debounced Auto-save

```javascript
// Prevents excessive DB writes
autoSaveTimeout = setTimeout(() => saveNote(), 1000);
```

### 3. Ref-based Content Updates

```javascript
// Avoid re-rendering on every keystroke
noteContentRef.current = newHtml;
triggerAutoSave(newHtml);
```

### 4. Memoized Filtering

```javascript
const filteredNotes = useMemo(() => {
  return notes.filter(/* ... */);
}, [activeFolder, notes]);
```

---

## Integration Points

### 1. Content Scripts

Highlights are captured via content scripts:

```javascript
// contentInteractions.js
window.addEventListener('mouseup', () => {
  const selection = window.getSelection().toString();
  if (selection) {
    showHighlightButton(selection);
  }
});
```

### 2. URL Notes

URL notes are created from workspace cards:

```javascript
// WorkspaceCard.jsx
<button onClick={() => createUrlNote(url)}>
  Add Note
</button>
```

### 3. Team Collaboration

Notes can be shared with P2P teams:

```javascript
// P2P Storage Service
await p2pStorage.addItemToTeam(teamId, {
  type: 'NOTE_SHARE',
  payload: note
});
```

---

## Usage Examples

### Creating a Note

```jsx
// In NotesCanvas
const createNewNote = () => {
  setActiveNote(null);
  setNoteContent('');
  setNoteTitle('');
  setNoteFolder(activeFolder === 'All Notes' ? '' : activeFolder);
  setIsEditing(true);
};
```

### Saving a Note

```javascript
const saveNote = async (content, noteId) => {
  const note = {
    id: noteId || `${Date.now()}_${random}`,
    text: content,
    title: extractTitle(content),
    folder: noteFolder,
    type: 'richtext',
    createdAt: noteId ? existingNote.createdAt : Date.now(),
    updatedAt: Date.now()
  };
  
  await dbUpsertNote(note);
  await loadNotes();
};
```

### Voice Input

```javascript
// Start recording
const toggleRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recognition = new SpeechRecognition();
  
  recognition.onresult = (event) => {
    const transcript = event.results[i][0].transcript;
    editorRef.current.insertContent(transcript);
  };
  
  recognition.start();
};
```

---

## Styling

### CSS Classes

```css
.notes-sidebar { /* Folder sidebar */ }
.notes-list { /* Notes list */ }
.note-item { /* Individual note card */ }
.note-editor { /* Editor container */ }
.custom-scrollbar { /* Custom scrollbar */ }
```

### Theme Variables

```css
--glass-bg: rgba(15, 23, 42, 0.95);
--border-primary: rgba(148, 163, 184, 0.2);
--text-primary: #F1F5F9;
--text-secondary: #94A3B8;
--accent-purple: #8B5CF6;
--accent-blue: #3B82F6;
```

---

## Troubleshooting

### Notes not saving
- Check browser console for errors
- Verify IndexedDB is enabled
- Check auto-save status indicator

### Voice input not working
- Ensure microphone permissions granted
- Check browser supports Web Speech API
- Verify HTTPS context (required for mic access)

### Shared notes not appearing
- Verify team connection active
- Check P2P sync service status
- Ensure both users in same team

### Default notes not created
- Check `settings.defaultNotesCreated` flag
- Manually trigger: `createDefaultNotes()`
- Clear settings: `await saveSettings({ defaultNotesCreated: false })`

---

## Future Enhancements

- [ ] Markdown export
- [ ] Note templates
- [ ] Nested folders
- [ ] Note linking (backlinks)
- [ ] Full-text search with highlighting
- [ ] Collaborative editing (real-time)
- [ ] Attachments (images, files)
- [ ] Note encryption
- [ ] Version history
- [ ] Tags system

---

## Related Components

- [TiptapEditor](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/spatial/editor/TiptapEditor.jsx) - Rich text editor
- [ShareNoteModal](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/popups/ShareNoteModal.jsx) - Team sharing UI
- [ReadNoteModal](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/popups/ReadNoteModal.jsx) - Read-only note view
- [SidebarNotes](file:///c:/Users/raghu/CascadeProjects/windsurf-project/extension/src/components/sidebar/views/SidebarNotes.jsx) - Sidebar notes view

---

## API Reference

### NotesCanvas Methods

```javascript
// Public methods (via ref)
createNewNote()           // Create new note
selectNote(note)          // Open existing note
handleDeleteNote(noteId)  // Delete note
toggleRecording()         // Start/stop voice input
handleShareNote()         // Share with team
```

### NotesWidget Methods

```javascript
handleAddNote()   // Save quick note
toggleVoice()     // Start/stop voice input
```

### Database Functions

```javascript
// Import from db/index.js
import { 
  upsertNote, 
  listNotes, 
  deleteNote,
  saveUrlNote,
  listAllUrlNotes,
  deleteUrlNote
} from './db/index.js';
```
