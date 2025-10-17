# Testing Chat Scraper Setup

## Issues Fixed

### 1. Database Version Not Incremented ✅
- **Problem**: Added `SCRAPED_CHATS` store but didn't increment DB version
- **Fix**: Changed `VERSION: 1` → `VERSION: 2` in `unified-db.js`
- **Result**: Migration v2 will now run and create the store

### 2. Migration Added ✅
- Added migration v2 to create `SCRAPED_CHATS` store
- Includes all indexes: `by_platform`, `by_scrapedAt`, `by_url`, `by_platform_scrapedAt`

## Testing Steps

### Step 1: Reload Extension
1. Go to `chrome://extensions/`
2. Find "cooldesk" extension
3. Click the **Reload** button (🔄)
4. Check for any errors in the extension

### Step 2: Check Database Migration
1. Open any page (or your extension)
2. Press **F12** to open DevTools
3. Go to **Console** tab
4. Look for these logs:
   ```
   [Unified DB] Opening database: cooldesk-unified-db v2
   [Unified DB] Upgrading database from v1 to v2
   [Migration v2] Adding SCRAPED_CHATS store...
   [Migration v2] Creating scraped_chats store
   [Migration v2] Created index: by_platform
   [Migration v2] Created index: by_scrapedAt
   [Migration v2] Created index: by_url
   [Migration v2] Created index: by_platform_scrapedAt
   [Migration v2] SCRAPED_CHATS store created successfully
   ```

### Step 3: Verify Database Store
1. In DevTools, go to **Application** tab
2. Expand **IndexedDB** in left sidebar
3. Find `cooldesk-unified-db`
4. You should see **`scraped_chats`** store listed
5. Click on it to verify indexes

### Step 4: Test Content Script on ChatGPT
1. Navigate to `https://chat.openai.com/` or `https://chatgpt.com/`
2. Open DevTools Console (**F12**)
3. Look for these logs:
   ```
   [ChatScraper] Content script loaded and ready
   [ChatScraper] Auto-scraping new chats...
   [ChatScraper] Previously scraped: 0 chats
   [ChatScraper] Waiting for sidebar...
   [ChatScraper] Sidebar loaded
   [ChatScraper] Found X chat elements
   ```

### Step 5: Check Auto-Scraping
After 3 seconds on ChatGPT, you should see:
```
[ChatScraper] ✓ NEW: Your chat title...
[ChatScraper] ✅ Found X new chats out of Y total
[ChatScraper] ✅ Auto-scraped X new chats
[Background] ✅ Auto-stored X new ChatGPT chats
```

## Troubleshooting

### If Content Script Doesn't Load
1. **Check manifest registration**: Verify `src/chatScraper.js` exists
2. **Check file path**: Make sure path is correct (not `dist/` or other folder)
3. **Check console errors**: Look for script loading errors
4. **Try hard refresh**: Ctrl+Shift+R on ChatGPT page

### If Database Store Not Created
1. **Delete old database**:
   - DevTools → Application → IndexedDB
   - Right-click `cooldesk-unified-db` → Delete database
   - Reload extension
2. **Check version**: Make sure `VERSION: 2` in unified-db.js
3. **Check migration logs**: Look for migration errors in console

### If No Logs Appear
1. **Check background script**: 
   - Go to `chrome://extensions/`
   - Click "service worker" link under your extension
   - Check for errors
2. **Verify content script injection**:
   - On ChatGPT page, open console
   - Type: `console.log('test')`
   - If this works, content scripts can run

## Expected Behavior

### On First Visit to ChatGPT:
- Content script loads automatically
- Waits 3 seconds for page to settle
- Scrapes all visible chats
- Marks them as "NEW"
- Stores in IndexedDB
- Saves chat IDs to chrome.storage.local

### On Subsequent Visits:
- Content script loads automatically
- Compares current chats with saved IDs
- Only scrapes NEW chats (not seen before)
- Logs "⊙ SEEN:" for old chats
- Logs "✓ NEW:" for new chats
- Only stores new chats in IndexedDB

## Manual Testing Commands

### Check Stored Chat IDs
```javascript
// In console on ChatGPT page
chrome.storage.local.get(['lastScraped_ChatGPT'], (result) => {
  console.log('Stored chat IDs:', result);
});
```

### Trigger Manual Scrape
```javascript
// In console on ChatGPT page
chrome.runtime.sendMessage({ type: 'SCRAPE_CHATS' }, (response) => {
  console.log('Manual scrape result:', response);
});
```

### Check IndexedDB Chats
```javascript
// In console (any page)
(async () => {
  const db = await indexedDB.open('cooldesk-unified-db', 2);
  db.onsuccess = () => {
    const tx = db.result.transaction(['scraped_chats'], 'readonly');
    const store = tx.objectStore('scraped_chats');
    const request = store.getAll();
    request.onsuccess = () => {
      console.log('Scraped chats:', request.result);
    };
  };
})();
```

## Success Criteria ✅

- [ ] Extension reloads without errors
- [ ] Migration v2 runs successfully
- [ ] `scraped_chats` store appears in IndexedDB
- [ ] Content script logs appear on ChatGPT
- [ ] Auto-scraping happens after 3 seconds
- [ ] New chats are stored in IndexedDB
- [ ] Subsequent visits only scrape new chats
