[plugin vite:reporter] 
(!) C:/Users/raghu/projects/extension/node_modules/y-protocols/awareness.js is dynamically imported by C:/Users/raghu/projects/extension/src/services/p2p/syncService.js but also statically imported by C:/Users/raghu/projects/extension/node_modules/y-webrtc/src/y-webrtc.js, dynamic import will not move module into another chunk.

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.