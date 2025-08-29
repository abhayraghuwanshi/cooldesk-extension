import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import manifest from './manifest.json'

// Switch between Chrome Extension (default) and Electron builds using env TARGET=electron
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.TARGET || process.env.TARGET
  const isElectron = mode === 'electron' || target === 'electron'

  if (isElectron) {
    // Electron build: no crx(), relative paths for file:// protocol
    return {
      base: './',
      plugins: [react()],
      build: { outDir: 'dist-electron', emptyOutDir: true },
    }
  }

  // Chrome extension build (default)
  return {
    base: './',
    plugins: [
      crx({
        manifest,
        // Explicitly define background script as a separate entry
        background: {
          entry: './src/background.js',
          type: 'module',
        },
        // Configure CSP for Firebase and localhost sync
        contentSecurityPolicy: {
          'extension_pages': "script-src 'self' 'wasm-unsafe-eval' http://localhost:* http://127.0.0.1:*; object-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.firebaseio.com https://accounts.google.com https://*.google.com https://identitytoolkit.googleapis.com http://localhost:* http://127.0.0.1:* wss://localhost:* ws://localhost:* ws://127.0.0.1:*"
        }
      }),
      react(),
    ],
  }
})
