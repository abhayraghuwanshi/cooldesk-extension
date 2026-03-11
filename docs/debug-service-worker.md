# Service Worker Debug Guide

## Current Setup Analysis

Your extension is configured correctly:
- ✅ Manifest V3 with `service_worker` in background
- ✅ Service worker file exists at `src/background/background.js`
- ✅ Build system (Vite + CRXJS) is configured
- ✅ Dev server is running

## Common Reasons Service Worker Doesn't Register

### 1. Extension Not Loaded in Chrome
**Check:**
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Look for your extension "New Tab by Cooldesk - Start Smarter"
4. Check if there are any errors shown

**Fix:** Click "Load unpacked" and select the `dist` folder

### 2. Service Worker Errors
**Check:**
1. Go to `chrome://extensions/`
2. Find your extension
3. Click "service worker" link (or "Inspect views: service worker")
4. Check the console for errors

### 3. Development Mode Issues
When running `npm run dev`, CRXJS handles the service worker differently.

**Try this:**
```bash
# Stop the dev server (Ctrl+C)
# Build for production
npm run build

# Then load the dist folder in Chrome
```

### 4. Check Service Worker Status

Run this in the service worker console (chrome://extensions/ → service worker):
```javascript
console.log('Service Worker Active:', self.registration);
console.log('Service Worker State:', self.registration?.active?.state);
```

### 5. Common Errors to Look For

#### Error: "Service worker registration failed"
- **Cause:** Syntax error in background.js
- **Fix:** Check the console for the specific error

#### Error: "Could not load background script"
- **Cause:** Path mismatch in manifest
- **Fix:** Ensure the path matches the built file

#### Error: "Unexpected token" or "Import statement outside module"
- **Cause:** ES modules not properly configured
- **Fix:** Already set with `"type": "module"` in manifest ✅

### 6. Force Reload the Extension

1. Go to `chrome://extensions/`
2. Click the refresh icon on your extension card
3. Or remove and re-add the extension

### 7. Check Build Output

Your dist manifest should show:
```json
{
  "background": {
    "service_worker": "service-worker-loader.js",
    "type": "module"
  }
}
```

This is correct! ✅

## Quick Debug Steps

1. **Open Chrome DevTools for Service Worker:**
   - Go to `chrome://extensions/`
   - Find your extension
   - Click "service worker" or "Inspect views: service worker"
   - Check console for the log: `[Background] ====== SERVICE WORKER STARTING ======`

2. **If you don't see the log:**
   - The service worker isn't starting
   - Check for errors in the console
   - Try reloading the extension

3. **Check Service Worker in Chrome:**
   - Go to `chrome://serviceworker-internals/`
   - Look for your extension ID
   - Check the status

## Most Likely Issue

Based on your setup, the most likely issue is:

**The extension needs to be reloaded after running `npm run dev`**

### Solution:
1. Keep `npm run dev` running
2. Go to `chrome://extensions/`
3. Find your extension
4. Click the **refresh/reload icon** 🔄
5. Check if "service worker" link appears
6. Click it to see the console

## If Still Not Working

Share the following information:
1. Screenshot of `chrome://extensions/` showing your extension
2. Any errors from the service worker console
3. Output of `chrome://serviceworker-internals/` for your extension
