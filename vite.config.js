import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import manifest from './manifest.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Switch between the Chrome extension (default) and the Tauri desktop app.
export default defineConfig(({ command }) => {
  const isBuild = command === 'build'

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
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
            spotlight: resolve(__dirname, 'spotlight.html'),
            handle: resolve(__dirname, 'handle.html'),
            // Sandboxed host page for user-authored widgets — only ever loaded
            // at runtime via <iframe src="widget-sandbox.html">, so it has no
            // static reference for Rollup to discover; must be a declared
            // entry or it's silently missing from dist-tauri.
            'widget-sandbox': resolve(__dirname, 'widget-sandbox.html'),
          },
          output: {
            // Split only libs already on the EAGER path into stable vendor chunks.
            // Do NOT blanket-group all node_modules: that would pull dynamically
            // imported heavies (@tiptap/*, react-force-graph-2d) into an eager
            // chunk and undo their lazy-loading. Anything not matched here is left
            // to Rollup's defaults, which keeps lazy chunks isolated.
            manualChunks(id) {
              if (!id.includes('node_modules')) return;
              const m = id.replace(/\\/g, '/');
              // Match react/react-dom/scheduler as exact path segments so
              // "react-force-graph-2d" is NOT captured by the "react" prefix.
              if (/\/node_modules\/(react|react-dom|scheduler)\//.test(m)) return 'vendor-react';
            }
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
          // Widgets are bundled (public/widgets/) and framed same-origin, so the
          // extension's own CSP now governs them: frame-src 'self' to embed them,
          // and their data-API hosts in connect-src (weather/crypto/currency/etc.),
          // which previously ran under cool-desk.com when framed cross-origin.
          'extension_pages': "script-src 'self' 'wasm-unsafe-eval' http://localhost:5173; object-src 'self'; frame-src 'self' https://www.google.com https://cool-desk.com; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.firebaseio.com https://accounts.google.com https://*.google.com https://identitytoolkit.googleapis.com https://api.open-meteo.com https://api.coingecko.com https://api.frankfurter.app https://en.wikipedia.org http://localhost:* http://127.0.0.1:* wss://localhost:* ws://localhost:* ws://127.0.0.1:*"
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
          // Sandboxed host page for user-authored widgets (manifest sandbox.pages)
          'widget-sandbox': resolve(__dirname, 'widget-sandbox.html'),
        },
        output: {
          //   manualChunks: (id) => {
          //     if (id.includes('node_modules')) {
          //       // Core React Bundle
          //       if (id.includes('react') || id.includes('react-dom')) {
          //         return 'vendor-react';
          //       }

          //       // FontAwesome
          //       if (id.includes('fontawesome')) {
          //         return 'vendor-styles';
          //       }

          //       // Heavy app-only deps should NOT be in extension bundle
          //       // These are excluded because ExtensionApp doesn't import them:
          //       // - @tiptap/* (notes editor)
          //       // - yjs, y-webrtc, y-indexeddb (P2P sync)
          //       // - node-llama-cpp (local AI)
          //       // - fuse.js (app search)

          //       return 'vendor';
          //     }
          //   }
        }
      }
    },
    esbuild: {
      legalComments: 'none',
      // Drop dev logging from the shipped extension. Marked `pure` rather than
      // `drop: ['console']` so console.error/console.warn survive — a store
      // reviewer or a user filing a bug still gets real failures in the console.
      // Build-only: `npm run dev` keeps every log.
      pure: isBuild
        ? ['console.log', 'console.debug', 'console.info', 'console.trace']
        : [],
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
