# CoolDesk Desktop App

## 🚀 Quick Start

### Development Mode

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run in development mode:**
   ```bash
   npm run dev:electron
   ```
   This will:
   - Start Vite dev server on http://localhost:5173
   - Launch Electron window automatically
   - Enable hot-reload for instant updates

### Production Build

1. **Build the app:**
   ```bash
   npm run build:electron
   ```

2. **Run the built app:**
   ```bash
   npm run electron
   ```

### Package for Distribution

Create installable packages for different platforms:

**Windows:**
```bash
npm run package:win
```
Creates `.exe` installer and portable version in `release/` folder

**macOS:**
```bash
npm run package:mac
```
Creates `.dmg` and `.zip` in `release/` folder

**Linux:**
```bash
npm run package:linux
```
Creates `.AppImage` and `.deb` in `release/` folder

## 📁 Project Structure

```
extension/
├── electron-main.js          # Electron main process
├── dist-electron/            # Built Electron app files
├── release/                  # Packaged installers
├── src/                      # React source code
├── public/                   # Static assets
└── vite.config.js           # Vite config with Electron support
```

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Chrome extension dev mode |
| `npm run dev:electron` | Desktop app dev mode with hot-reload |
| `npm run build` | Build Chrome extension |
| `npm run build:electron` | Build desktop app |
| `npm run electron` | Run built desktop app |
| `npm run package:win` | Create Windows installer |
| `npm run package:mac` | Create macOS installer |
| `npm run package:linux` | Create Linux installer |

## 🎯 Features

- ✅ **Cross-platform**: Windows, macOS, Linux
- ✅ **Hot-reload**: Instant updates during development
- ✅ **Native installers**: NSIS, DMG, AppImage, DEB
- ✅ **Same codebase**: Shared with Chrome extension
- ✅ **Modern UI**: React + Vite + Electron

## 🐛 Troubleshooting

**Electron window doesn't open:**
- Make sure Vite dev server is running on port 5173
- Check console for errors

**Build fails:**
- Run `npm install` to ensure all dependencies are installed
- Clear `dist-electron/` folder and rebuild

**Package fails:**
- Ensure you've run `npm run build:electron` first
- Check that `electron-main.js` exists in project root

## 📝 Notes

- The app uses the same React codebase as the Chrome extension
- Electron mode disables Chrome extension APIs
- Data is stored in the user's local app data folder
- DevTools are enabled in development mode
