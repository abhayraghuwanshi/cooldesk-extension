# Status Code 15 - Service Worker Evaluation Failed

## What is Status Code 15?
**Status Code 15** means: **"Service worker script evaluation failed"**

This indicates there's a **runtime error** when Chrome tries to execute the background script. The script loads, but throws an error during execution.

## Current Status
- ✅ Build completes successfully (no syntax errors)
- ✅ Files are generated correctly:
  - `service-worker-loader.js` (45 bytes)
  - `assets/background.js-Bj-BNJ6u.js` (78.60 KB)
- ❌ Service worker fails with **Status Code 15** when Chrome tries to run it

## What We've Tried
1. ✅ Removed explicit background config from vite.config.js
2. ✅ Disabled Search Indexer initialization
3. ✅ Clean rebuild

## Next Steps to Debug

### 1. Check Chrome DevTools Console
The most important step is to see the **actual error message**:

1. Go to `chrome://extensions/`
2. Find your extension
3. Click on **"service worker"** link (even if it shows as inactive/failed)
4. This opens the Service Worker DevTools
5. Look for **red error messages** in the console
6. **Copy the exact error message** including the stack trace

### 2. Common Causes of Status Code 15

#### A. Import/Module Errors
- Missing module
- Circular dependency
- Invalid import path

#### B. Top-Level Code Execution Errors
- Code that runs immediately when module loads
- API calls that fail (e.g., `chrome.tabs` before ready)
- Database initialization errors

#### C. Syntax Errors in Dependencies
- One of the imported modules has an error
- Minification broke something

### 3. Temporary Workaround - Minimal Test

Let's create a minimal background.js to test if the build process itself works:

```javascript
// Minimal test - just log
console.log('[Background] Minimal test - SERVICE WORKER STARTING');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed');
});
```

If this works, we know the issue is in the actual background.js code, not the build process.

### 4. Check for Specific Issues

Based on the code, potential issues:

#### Issue 1: CommandExecutor Initialization (Line 219)
```javascript
const commandExecutor = new CommandExecutor((feedback) => {
  console.log('[Background:Command] Feedback:', feedback);
  chrome.tabs.query({active: true, currentWindow: true}).then(([tab]) => {
    if (tab) chrome.tabs.sendMessage(tab.id, {...});
  });
});
```

This runs at module load time and might fail if Chrome APIs aren't ready.

#### Issue 2: Database Imports
The imports from `../db/index.js` might be failing if there's a database initialization error.

#### Issue 3: Command Handler (Lines 14-50)
The `chrome.commands.onCommand.addListener` runs at top level and might fail.

## What You Need to Do

**Please provide the exact error message from the Service Worker console:**

1. Open `chrome://extensions/`
2. Click "service worker" (even if inactive)
3. Copy the **full error message** including:
   - Error type (e.g., "TypeError", "ReferenceError")
   - Error message
   - File name and line number
   - Stack trace

**Example of what I need:**
```
Uncaught ReferenceError: initializeSearchIndexer is not defined
    at background.js-Bj-BNJ6u.js:1:2345
    at ...
```

Once I have the exact error, I can fix it immediately!

## Possible Quick Fixes

If you can't get the error message, try these in order:

### Fix 1: Comment out CommandExecutor
In `background.js`, comment out lines 218-225:

```javascript
// Initialize CommandExecutor for shared use
// const commandExecutor = new CommandExecutor((feedback) => {
//   console.log('[Background:Command] Feedback:', feedback);
//   ...
// });
```

### Fix 2: Comment out Commands Listener
Comment out the entire `chrome.commands.onCommand.addListener` block (lines ~14-50).

### Fix 3: Move Everything Inside main()
Move all top-level code into the `main()` function so nothing runs at module load time.
