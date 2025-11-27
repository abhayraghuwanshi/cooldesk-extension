# 🚀 CoolDesk Command Center - User Guide

Welcome to the CoolDesk Command Center! You can now use powerful commands directly in the search bar.

---

## 🎯 Quick Start

Just type `!` followed by a command in the search bar and press Enter.

**Example**: Type `!jump github` and press Enter to instantly jump to your GitHub tab!

---

## 📋 Available Commands

### 🧭 Core Navigation

#### `!jump <tab name>`
Jump to an open tab by name (fuzzy search).
```
!jump github
!jump gmail
!jump docs
```

#### `!go <shortcut>`
Open popular websites instantly using shortcuts.
```
!go yt      → YouTube
!go gm      → Gmail
!go gh      → GitHub
!go fig     → Figma
!go tw      → Twitter
!go fb      → Facebook
!go ig      → Instagram
!go li      → LinkedIn
!go rd      → Reddit
!go so      → StackOverflow
!go wiki    → Wikipedia
!go amz     → Amazon
!go nf      → Netflix
!go spot    → Spotify
```

#### `!back` & `!forward`
Navigate browser history.
```
!back       → Go back
!forward    → Go forward
```

#### `!spot <query>` 🔥
**Universal Spotlight Search** - Searches EVERYWHERE at once!
- Open tabs
- Browser history
- Bookmarks
- Workspaces
- Commands

```
!spot react hooks
!spot api docs
!spot meeting notes
```

#### `!history <query>`
Search your browser history.
```
!history stripe documentation
!history yesterday meeting
```

#### `!recent`
Show recently closed tabs.
```
!recent
```

---

### 💼 Workspace Commands

#### `!ws switch <name>`
Switch to a workspace instantly.
```
!ws switch work
!ws switch personal
!ws switch dev
```

#### `!ws create <name>`
Create a new workspace.
```
!ws create project-x
!ws create client-work
```

#### `!ws clean`
Intelligently close duplicate and unused tabs.
```
!ws clean
```

#### `!ws focus`
Focus mode - close all tabs except pinned and active.
```
!ws focus
```

#### `!save`
Save all open tabs to your current workspace.
```
!save
```

#### `!snapshot`
Capture your entire browser state (tabs, workspaces, pins).
```
!snapshot
```

#### `!session restore`
Restore your last saved session/snapshot.
```
!session restore
```

---

### 🤖 AI Commands (Coming Soon)

These require Gemini API key configuration (Settings → AI).

#### `!answer <question>`
AI answers questions about the current page.
```
!answer what is the main point?
!answer how does this work?
```

#### `!summarize`
AI summarizes the current page.
```
!summarize
```

#### `!explain`
AI explains the current page in detail.
```
!explain
```

#### `!write <text>`
AI helps write notes.
```
!write meeting notes about...
```

---

### ✨ Special Commands

#### `!?`
Show all available commands (command palette).
```
!?
```

#### `!magic` 🔮
AI suggests relevant commands based on your current activity.
```
!magic
```

---

## 💡 Tips & Tricks

### 1. Fuzzy Matching
Commands use smart fuzzy search - you don't need exact matches!
```
!jump git      → Finds "GitHub - Pull Requests"
!ws switch dev → Finds "Development Workspace"
```

### 2. Visual Feedback
- ✅ **Green** = Success
- ❌ **Red** = Error
- ℹ️ **Blue** = Info

### 3. Help Hint
When you type `!`, you'll see a hint to type `!?` for help.

### 4. Command History
Commands work just like regular search - use them anytime in the search bar.

### 5. Keyboard Shortcuts
- Press `Enter` to execute command
- Press `Esc` to clear search
- Start typing `!` to see command hint

---

## 🎨 Examples

### Daily Workflow
```bash
# Morning routine
!ws switch work
!go gm
!go gh
!recent

# Focus time
!ws focus
!ws clean

# End of day
!snapshot
!save
```

### Power User Tricks
```bash
# Quick tab management
!jump slack
!jump figma
!jump jira

# Universal search
!spot api documentation
!spot that article about...

# Workspace juggling
!ws switch client-a
!save
!ws switch client-b
!session restore
```

### Keyboard Navigation
```bash
!back
!forward
!recent
!ws clean
```

---

## 🔧 Advanced

### Command Structure
```
!<command> [subcommand] [arguments]
```

Examples:
- `!jump github` → command: jump, args: github
- `!ws switch work` → command: ws, subcommand: switch, args: work
- `!spot react` → command: spot, args: react

### Error Messages
Commands provide helpful error messages:
```
!jump nonexistent
❌ No tab found matching "nonexistent"

!ws switch fake
❌ Workspace "fake" not found

!go xyz
❌ Unknown shortcut "xyz". Available: yt, gm, gh, ...
```

---

## 🚀 Coming Soon

### Phase 2: AI Features
- `!answer` - AI Q&A about current page
- `!summarize` - AI page summarization
- `!explain` - AI detailed explanations

### Phase 3: Automation
- `!flow record` - Record action workflows
- `!flow run <name>` - Run saved workflows

### Phase 4: Integrations
- `!weather` - Quick weather check
- `!news` - AI news summary
- `!stocks <symbol>` - Stock prices

---

## 🐛 Troubleshooting

### Command not working?
1. Make sure you start with `!`
2. Check spelling (or use fuzzy matching)
3. Type `!?` to see all available commands
4. Check console (F12) for errors

### Workspace commands not working?
1. Make sure you have workspaces created
2. Use `!ws switch <name>` to activate a workspace first
3. Use `!ws create <name>` to create new workspace

### AI commands not working?
1. AI features require Gemini API key
2. Go to Settings (⚙️) and add your API key
3. Coming in next update!

---

## 🎓 Learning Path

1. **Start Simple**: Try `!go` shortcuts
   ```
   !go yt
   !go gm
   ```

2. **Tab Management**: Master `!jump`
   ```
   !jump github
   !jump docs
   ```

3. **Universal Search**: Use `!spot`
   ```
   !spot react hooks
   ```

4. **Workspaces**: Organize with `!ws`
   ```
   !ws create work
   !ws switch work
   !save
   ```

5. **Power Features**: Snapshots and magic
   ```
   !snapshot
   !magic
   ```

---

## 📊 Command Cheat Sheet

| Command | What it does | Example |
|---------|--------------|---------|
| `!jump` | Jump to tab | `!jump github` |
| `!go` | Open shortcut | `!go yt` |
| `!spot` | Universal search | `!spot api docs` |
| `!ws switch` | Switch workspace | `!ws switch work` |
| `!ws clean` | Clean duplicate tabs | `!ws clean` |
| `!save` | Save all tabs | `!save` |
| `!snapshot` | Capture state | `!snapshot` |
| `!?` | Show help | `!?` |
| `!magic` | AI suggestions | `!magic` |

---

## 🎉 Pro Tips

### Speed Tips
- Use shortest shortcuts: `!go yt` instead of navigating to YouTube
- Use `!jump` + first letters: `!jump gh` finds GitHub
- Use `!ws` shortcuts to switch contexts instantly

### Organization Tips
- Create workspace per project: `!ws create project-name`
- Use `!snapshot` before big changes
- Use `!ws clean` weekly to remove clutter

### Productivity Tips
- Start your day with `!ws switch work`
- End your day with `!snapshot`
- Use `!spot` instead of multiple searches

---

## 💬 Feedback

Found a bug? Want a new command?
- File an issue on GitHub
- Or suggest via settings

---

**Happy commanding! 🚀**
