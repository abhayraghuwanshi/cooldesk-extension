import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    crx({
      manifest,
      // Explicitly define background script as a separate entry
      background: {
        entry: './src/background.js',
        type: 'module'
      }
    }),
    react(),
  ],
})
