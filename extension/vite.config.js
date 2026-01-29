import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import manifest from './manifest.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Switch between Chrome Extension (default) and Electron builds using env TARGET=electron
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'

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
          entry: './src/background/background.js',
          type: 'module',
        },
        // Configure CSP for Firebase and localhost sync
        contentSecurityPolicy: {
          'extension_pages': "script-src 'self' 'wasm-unsafe-eval' http://localhost:* http://127.0.0.1:*; object-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.firebaseio.com https://accounts.google.com https://*.google.com https://identitytoolkit.googleapis.com http://localhost:* http://127.0.0.1:* wss://localhost:* ws://localhost:* ws://127.0.0.1:*"
        }
      }),
      react(),
    ],
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
    build: {
      target: 'esnext', // Use modern JS
      modulePreload: {
        polyfill: true,
      },
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          sidebar: resolve(__dirname, 'sidebar.html'),
        },
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              // Core React Bundle (Safe to split)
              if (id.includes('react') || id.includes('react-dom')) {
                return 'vendor-react';
              }

              // Utils & Styles
              if (id.includes('fontawesome')) {
                return 'vendor-styles';
              }

              // Note: Tiptap and YJS are tightly coupled. Keeping them in the main vendor chunk
              // prevents "Cannot access 'X' before initialization" errors due to circular deps.

              return 'vendor'; // All other node_modules
            }
          }
        }
      }
    },
    esbuild: {
      // drop: ['console', 'debugger'],
      legalComments: 'none'
    },
    define: {
      'global': 'window',
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis',
        }
      }
    }
  }
})
