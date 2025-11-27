# Draggable Sections Feature

## Overview
All main sections below the search panel are now draggable and their order persists across page refreshes.

## Draggable Components
The following components can be rearranged by dragging:

1. **Quick Access** - Pings and feed sections
2. **Shared Workspace** - Team collaboration workspace
3. **Pinned Workspace** - Your pinned workspaces
4. **Workspace Section** - Main workspace view
5. **Active Tabs** - Current browser tabs
6. **AI Chats** - Claude and ChatGPT conversations
7. **Notes** - Simple notes section
8. **Notice Board** - Announcements and notices

## How to Use

### Drag and Drop
1. **Hover** over any section - you'll see a drag handle icon (6 dots) in the top-left corner
2. **Click and hold** on any section
3. **Drag** the section up or down to reorder
4. **Release** to drop it in the new position

### Keyboard Navigation
- **Tab** to focus on a section
- **Space** or **Enter** to activate drag mode
- **Arrow keys** to move the section up/down
- **Space** or **Enter** again to drop

### Persistence
- Your section order is automatically saved to:
  - **localStorage** - For instant loading on next visit
  - **IndexedDB** - For persistence across browser sessions
- Order is restored automatically when you refresh the page

## Implementation Details

### Files Modified
- `src/App.jsx` - Refactored to use draggable sections
- `src/components/DraggableSections.jsx` - New component managing drag-and-drop

### Library Used
- **@dnd-kit** - Modern, accessible drag-and-drop library
  - `@dnd-kit/core` - Core drag-and-drop functionality
  - `@dnd-kit/sortable` - Sortable list utilities
  - `@dnd-kit/utilities` - Helper utilities

### Storage Key
- The section order is stored under the key: `mainSectionOrder`
- Format: Array of section IDs (e.g., `['quick-access', 'notes', 'shared-workspace', ...]`)

### Features
- ✅ Smooth drag animations
- ✅ Visual feedback during drag (opacity and cursor changes)
- ✅ Drag handle indicator
- ✅ Keyboard accessibility
- ✅ Touch device support
- ✅ Automatic persistence to localStorage and IndexedDB
- ✅ Order restoration on page load
- ✅ Handles dynamic section additions/removals

## Troubleshooting

### Order not persisting?
- Check browser console for errors
- Verify localStorage is enabled
- Try clearing `mainSectionOrder` from localStorage and refresh

### Sections not draggable?
- Ensure JavaScript is enabled
- Check that the DraggableSections component is rendering
- Look for console errors

### Reset to default order
Run this in browser console:
```javascript
localStorage.removeItem('mainSectionOrder');
location.reload();
```

## Future Enhancements
- Add a "Reset to Default" button in settings
- Add section visibility toggles (show/hide)
- Add section grouping/collapsing
- Add drag handles on hover only
- Add animation preferences
