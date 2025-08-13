# Bookmark Syncer Extension

A Chrome extension that syncs your bookmarks to a web-hosted landing page.

## Features
- Extract bookmarks from Chrome browser
- Display bookmarks in a beautiful web interface
- Sync bookmarks to a hosted server
- Unique user ID for each installation

## Hosting Options

### 1. Local Development
1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Load the Chrome extension:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select this folder

4. Use the extension:
   - Click the extension icon
   - Click "Sync Bookmarks"
   - Visit `http://localhost:3000/landing/[your-user-id]`

### 2. Production Hosting

#### Option A: Vercel (Recommended)
1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Follow the prompts
4. Update the server URL in `background.js`

#### Option B: Heroku
1. Create a Heroku app
2. Deploy using Git:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   heroku git:remote -a your-app-name
   git push heroku main
   ```

#### Option C: Railway
1. Connect your GitHub repo to Railway
2. Deploy automatically
3. Update the server URL in `background.js`

### 3. Chrome Web Store
1. Zip the extension files
2. Pay $5 developer fee
3. Submit for review
4. Wait 1-7 days for approval

## Files Structure
- `manifest.json` - Extension configuration
- `popup.html/js` - Extension popup UI
- `background.js` - Extension background script
- `landing.html/js` - Local landing page
- `server.js` - Web server for hosting
- `web-landing.html` - Web-hosted landing page
- `package.json` - Node.js dependencies

## API Endpoints
- `POST /api/bookmarks/:userId` - Save bookmarks
- `GET /api/bookmarks/:userId` - Get bookmarks
- `GET /landing/:userId` - View landing page
