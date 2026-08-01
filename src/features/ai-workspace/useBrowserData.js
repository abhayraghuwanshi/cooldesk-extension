import { useState, useEffect, useCallback } from 'react';

export function useBrowserData(isOpen) {
  const [tabs, setTabs] = useState([]);
  const [history, setHistory] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadBrowserData = useCallback(async () => {
    setIsLoading(true);

    try {
      // Load tabs — Chrome API first, then sidecar fallback (desktop/Tauri mode)
      if (chrome?.tabs) {
        const tabsList = await new Promise(resolve => {
          chrome.tabs.query({}, (result) => {
            resolve(result.map(tab => ({
              url: tab.url,
              title: tab.title,
              favicon: tab.favIconUrl,
              id: tab.id
            })).filter(t => t.url && !t.url.startsWith('chrome://')));
          });
        });
        setTabs(tabsList);
      } else {
        // Desktop app (Tauri): fetch tabs synced to sidecar from Chrome extension
        try {
          const response = await fetch('http://127.0.0.1:4545/tabs', {
            signal: AbortSignal.timeout(3000)
          });
          if (response.ok) {
            const sidecarTabs = await response.json();
            setTabs(
              (sidecarTabs || [])
                .map(tab => ({ url: tab.url, title: tab.title, favicon: tab.favicon, id: tab.id }))
                .filter(t => t.url && !t.url.startsWith('chrome://'))
            );
          }
        } catch (e) {
          console.log('[useBrowserData] Sidecar tabs not available:', e.message);
        }
      }

      // Load history
      if (chrome?.history) {
        const historyList = await new Promise(resolve => {
          chrome.history.search({
            text: '',
            maxResults: 1000,
            startTime: Date.now() - 30 * 24 * 60 * 60 * 1000 // Last 30 days
          }, (results) => {
            resolve(results.filter(h => h.url && !h.url.startsWith('chrome://')));
          });
        });
        setHistory(historyList);
      }

      // Load bookmarks
      if (chrome?.bookmarks) {
        const bookmarksList = await new Promise(resolve => {
          chrome.bookmarks.getTree((tree) => {
            const flat = [];
            const traverse = (nodes) => {
              nodes.forEach(node => {
                if (node.url) {
                  flat.push({
                    id: node.id,
                    title: node.title,
                    url: node.url
                  });
                }
                if (node.children) {
                  traverse(node.children);
                }
              });
            };
            traverse(tree);
            resolve(flat);
          });
        });
        setBookmarks(bookmarksList);
      }
    } catch (err) {
      console.error('[useBrowserData] Error loading browser data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadBrowserData();
    }
  }, [isOpen, loadBrowserData]);

  return {
    tabs,
    history,
    bookmarks,
    isLoading,
    refresh: loadBrowserData
  };
}
