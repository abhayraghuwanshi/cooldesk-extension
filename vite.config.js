import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import manifest from './manifest.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Switch between Chrome Extension (default) and Electron/Tauri builds using env
export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron'

  if (isElectron) {
    // Electron build: no crx(), relative paths for file:// protocol
    // Uses full App with all features (notes, tabs, team, etc.)
    return {
      base: './',
      plugins: [react()],
      server: {
        port: 5173,
        strictPort: true,
        hmr: {
          port: 5173,
          clientPort: 5173,
        },
        watch: {
          usePolling: true,
        },
      },
      build: {
        outDir: 'dist-electron',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
            spotlight: resolve(__dirname, 'spotlight.html'),
          }
        }
      },
    }
  }

  // Tauri build
  const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

  if (isTauri) {
    // Uses full App with all features
    return {
      base: './',
      clearScreen: false,
      server: {
        port: 5173,
        strictPort: true,
        host: true,
        hmr: {
          port: 5173,
          clientPort: 5173,
        },
        watch: {
          ignored: ["**/src-tauri/**"],
        },
      },
      envPrefix: ["VITE_", "TAURI_"],
      build: {
        target: process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
        minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
        outDir: 'dist-tauri',
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
            spotlight: resolve(__dirname, 'spotlight.html'),
          }
        }
      },
      plugins: [react()],
    }
  }

  // Chrome Extension build (default)
  // Uses lightweight ExtensionApp - only Overview page, no heavy deps
  return {
    base: './',

    plugins: [
      crx({
        manifest,
        contentSecurityPolicy: {
          'extension_pages': "script-src 'self' 'wasm-unsafe-eval' http://localhost:5173; object-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.firebaseio.com https://accounts.google.com https://*.google.com https://identitytoolkit.googleapis.com http://localhost:* http://127.0.0.1:* wss://localhost:* ws://localhost:* ws://127.0.0.1:*"
        }
      }),
      react(),
    ],
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
        clientPort: 5173,
      },
    },
    build: {
      target: 'esnext',
      modulePreload: {
        polyfill: true,
      },
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          // Extension uses lightweight entry point
          main: resolve(__dirname, 'extension.html'),
        },
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              // Core React Bundle
              if (id.includes('react') || id.includes('react-dom')) {
                return 'vendor-react';
              }

              // FontAwesome
              if (id.includes('fontawesome')) {
                return 'vendor-styles';
              }

              // Heavy app-only deps should NOT be in extension bundle
              // These are excluded because ExtensionApp doesn't import them:
              // - @tiptap/* (notes editor)
              // - yjs, y-webrtc, y-indexeddb (P2P sync)
              // - node-llama-cpp (local AI)
              // - fuse.js (app search)

              return 'vendor';
            }
          }
        }
      }
    },
    esbuild: {
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
