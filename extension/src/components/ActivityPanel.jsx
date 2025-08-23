import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { TabPreviewModal } from './TabPreviewModal';
import { NotesSection } from './NotesSection';
import { CurrentTabsSection } from './CurrentTabsSection';
import { PingsSection } from './PingsSection';
import { CoolFeedSection } from './CoolFeedSection';

export function ActivityPanel() {
  // State for preview modal
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [previewData, setPreviewData] = React.useState(null);

  // Add ping function
  const addPing = React.useCallback(async (tab) => {
    try {
      if (!tab?.url) return;
      const { upsertPing } = await import('../db');
      const { getFaviconUrl } = await import('../utils');

      const ping = {
        url: tab.url,
        title: tab.title || (() => { try { return new URL(tab.url).hostname; } catch { return tab.url; } })(),
        favicon: (() => {
          const safeHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
          const primary = (tab.favIconUrl && safeHttp(tab.favIconUrl)) ? tab.favIconUrl : getFaviconUrl(tab.url, 64);
          try {
            const u = new URL(tab.url);
            const originIco = (u.protocol === 'http:' || u.protocol === 'https:') ? `${u.origin}/favicon.ico` : '';
            return primary || originIco || '';
          } catch { return primary || ''; }
        })(),
        createdAt: Date.now(),
      };
      await upsertPing(ping);
    } catch (e) {
      console.warn('Failed to add ping:', e);
    }
  }, []);

  // Request preview function
  const requestPreview = React.useCallback(async (tab) => {
    const url = tab?.url;
    if (!url) return;
    
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewData({ title: 'Loading…' });
    
    try {
      const hasRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;
      if (!hasRuntime) {
        setPreviewLoading(false);
        setPreviewError('Preview not available in this environment');
        return;
      }
      
      const resp = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out')), 8000);
        try {
          chrome.runtime.sendMessage({ action: 'fetchPreview', url }, (res) => {
            clearTimeout(timer);
            const lastErr = chrome.runtime?.lastError;
            if (lastErr) return reject(new Error(lastErr.message || 'Service worker unavailable'));
            resolve(res);
          });
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
      
      const data = resp?.ok ? (resp.data || null) : null;
      const err = resp?.ok ? '' : (resp?.error || 'Failed to load preview');

      if (data) {
        setPreviewData(data);
        setPreviewError('');
      } else {
        setPreviewError(err || 'Failed to load preview');
      }
    } catch (e) {
      setPreviewError(String(e?.message || e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  return (
    <section style={{ marginTop: 12 }}>
      <ErrorBoundary>
        <div style={{ marginTop: 16 }}>
          <CurrentTabsSection onAddPing={addPing} onRequestPreview={requestPreview} />
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div style={{ marginTop: 24 }}>
          <PingsSection />
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div style={{ marginTop: 24 }}>
          <NotesSection />
        </div>
      </ErrorBoundary>

      <ErrorBoundary>
        <div style={{ marginTop: 24 }}>
          <CoolFeedSection />
        </div>
      </ErrorBoundary>

      <TabPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        data={previewData}
        loading={previewLoading}
        error={previewError}
        onOpenFull={() => {
          try {
            const url = previewData?.url || (typeof previewData === 'string' ? previewData : null);
            if (!url) { setPreviewOpen(false); return; }
            if (typeof chrome !== 'undefined' && chrome?.tabs?.create) chrome.tabs.create({ url });
            else window.open(url, '_blank');
          } catch { }
          setPreviewOpen(false);
        }}
      />
    </section>
  );
}
