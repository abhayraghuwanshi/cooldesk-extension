import React from 'react';

const MAX_TEXT_LENGTH = 20000;

function formatSourceLabel(source, fallback = 'Current page') {
  const title = typeof source?.title === 'string' ? source.title.trim() : '';
  const url = typeof source?.url === 'string' ? source.url.trim() : '';
  if (title && url) return `${title} — ${url}`;
  return title || url || fallback;
}

function getSummarizer() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.Summarizer;
}

export function AIToolPanel() {
  const [supported, setSupported] = React.useState(() => Boolean(getSummarizer()));
  const [availability, setAvailability] = React.useState('checking');
  const [status, setStatus] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [error, setError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState(null);
  const [sourceInfo, setSourceInfo] = React.useState('');
  const [urlInput, setUrlInput] = React.useState('');
  const summarizerRef = React.useRef(null);

  const updateAvailability = React.useCallback(async () => {
    const SummarizerAPI = getSummarizer();
    if (!SummarizerAPI) {
      setSupported(false);
      setAvailability('unsupported');
      return;
    }
    setSupported(true);
    try {
      const value = await SummarizerAPI.availability();
      setAvailability(value);
    } catch (err) {
      console.warn('[AIToolPanel] availability check failed', err);
      setAvailability('error');
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await updateAvailability();
      if (!cancelled && supported) {
        const SummarizerAPI = getSummarizer();
        if (!SummarizerAPI) {
          setSupported(false);
          setAvailability('unsupported');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, updateAvailability]);

  const fetchActiveTabText = React.useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
      throw new Error('Chrome extension APIs unavailable');
    }
    const pickReadableTab = (tabs = []) => tabs.find(tab => {
      if (!tab?.id) return false;
      const url = tab.url || '';
      return /^https?:/i.test(url);
    });

    let activeTab = pickReadableTab(await chrome.tabs.query({ active: true, lastFocusedWindow: true }));

    if (!activeTab) {
      activeTab = pickReadableTab(await chrome.tabs.query({ active: true, windowType: 'normal' }));
    }

    if (!activeTab) {
      activeTab = pickReadableTab(await chrome.tabs.query({ active: true }));
    }

    if (!activeTab?.id) {
      throw new Error('Focus a webpage tab before summarizing.');
    }

    const tabUrl = activeTab.url || '';
    let urlProtocol = '';
    try {
      urlProtocol = new URL(tabUrl).protocol;
    } catch {
      urlProtocol = '';
    }
    if (!tabUrl || (urlProtocol && urlProtocol !== 'http:' && urlProtocol !== 'https:')) {
      throw new Error('Switch to a regular webpage to generate a summary');
    }
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const selection = window.getSelection?.()?.toString?.();
          const baseText = selection && selection.trim().length > 0 ? selection.trim() : document.body?.innerText || '';
          return baseText.slice(0, MAX_TEXT_LENGTH);
        }
      });
    } catch (err) {
      const message = err?.message || '';
      if (message.includes('Cannot access contents of url')) {
        throw new Error('CoolDesk needs an http(s) webpage to summarize. Open a regular site and try again.');
      }
      throw new Error(`Failed to read page: ${message || 'Unknown error'}`);
    }
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('No readable content found. Reload the page or select text before summarizing.');
    }
    const content = results[0]?.result;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('No readable content found. Try selecting text or opening a different page.');
    }
    return { text: content, title: activeTab.title || '', url: activeTab.url || '' };
  }, []);

  const fetchUrlText = React.useCallback(async (rawUrl) => {
    if (!rawUrl || !rawUrl.trim()) {
      throw new Error('Enter a page link to summarize');
    }
    let normalized = rawUrl.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(normalized);
    } catch {
      throw new Error('Enter a valid http(s) URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Only http(s) URLs are supported');
    }
    const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime?.sendMessage;
    if (!hasRuntime) {
      throw new Error('Chrome runtime unavailable for link fetch');
    }

    const { success, html, error, url: resolvedUrl } = await new Promise((resolve, reject) => {
      let settled = false;
      try {
        chrome.runtime.sendMessage({ type: 'FETCH_URL_TEXT', url: parsedUrl.toString() }, (response) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr && !settled) {
            settled = true;
            reject(new Error(lastErr.message || 'Runtime messaging failed'));
            return;
          }
          if (!settled) {
            settled = true;
            resolve(response || { success: false, error: 'No response from background' });
          }
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Timed out fetching link'));
        }
      }, 15000);
    }).catch((err) => {
      throw new Error(err?.message || 'Failed to fetch page');
    });

    if (!success || !html) {
      throw new Error(error || 'Failed to fetch page');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const title = doc.querySelector('title')?.textContent?.trim() || parsedUrl.hostname;
    let text = doc.body?.innerText || doc.body?.textContent || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      throw new Error('The fetched page did not contain readable text');
    }
    return {
      text: text.slice(0, MAX_TEXT_LENGTH),
      title,
      url: resolvedUrl || parsedUrl.toString()
    };
  }, []);

  const ensureSummarizer = React.useCallback(async () => {
    const SummarizerAPI = getSummarizer();
    if (!SummarizerAPI) {
      throw new Error('Summarizer API unsupported in this browser');
    }
    const availabilityState = await SummarizerAPI.availability();
    setAvailability(availabilityState);
    if (availabilityState === 'unavailable') {
      throw new Error('Summarizer unavailable on this device');
    }
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      throw new Error('Summarizer requires a recent user gesture');
    }
    if (summarizerRef.current) {
      setDownloadProgress(null);
      return summarizerRef.current;
    }
    setStatus('Downloading model…');
    setDownloadProgress(0);
    try {
      const summarizer = await SummarizerAPI.create({
        type: 'key-points',
        length: 'medium',
        format: 'markdown',
        sharedContext: 'Summaries tailored for CoolDesk users.',
        monitor(monitorTarget) {
          const handleProgress = (evt) => {
            let rawProgress = null;
            if (typeof evt?.progress === 'number') {
              rawProgress = evt.progress;
            } else if (typeof evt?.loaded === 'number' && typeof evt?.total === 'number' && evt.total > 0) {
              rawProgress = evt.loaded / evt.total;
            } else if (typeof evt?.loaded === 'number') {
              rawProgress = evt.loaded <= 1 ? evt.loaded : Math.min(evt.loaded, 1);
            } else if (typeof evt?.detail?.progress === 'number') {
              rawProgress = evt.detail.progress;
            }

            if (rawProgress === null || Number.isNaN(rawProgress)) {
              return;
            }

            const clamped = Math.min(1, Math.max(0, rawProgress));
            const percent = Math.round(clamped * 100);
            setDownloadProgress(percent);
            setStatus(percent >= 100 ? 'Finalizing download…' : 'Downloading model…');
          };

          const handleComplete = () => {
            setDownloadProgress(100);
            setStatus('Finalizing download…');
          };

          monitorTarget.addEventListener('downloadprogress', handleProgress);
          monitorTarget.addEventListener('downloadcomplete', handleComplete);
          monitorTarget.addEventListener('downloadfinished', handleComplete);
        }
      });
      summarizerRef.current = summarizer;
      setDownloadProgress(100);
      setStatus('Model ready');
      setAvailability('available');
      return summarizer;
    } catch (err) {
      summarizerRef.current = null;
      throw err;
    }
  }, []);

  const summarizeWithChunks = React.useCallback(async (summarizer, text, sourceLabel) => {
    const MAX_CHARS = 4000;
    const CHUNK_OVERLAP = 400;

    if (text.length <= MAX_CHARS) {
      setStatus('Summarizing…');
      const result = await summarizer.summarize(text, {
        context: 'Provide concise key takeaways and capture critical details.'
      });
      setSummary(result);
      setStatus('Summary ready');
      return;
    }

    const chunks = [];
    for (let start = 0; start < text.length; start += (MAX_CHARS - CHUNK_OVERLAP)) {
      const end = Math.min(text.length, start + MAX_CHARS);
      const chunkText = text.slice(start, end);
      chunks.push(chunkText);
      if (end >= text.length) {
        break;
      }
    }

    const chunkSummaries = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      setStatus(`Summarizing ${index + 1}/${chunks.length}…`);
      try {
        const summary = await summarizer.summarize(chunk, {
          context: 'Summarize only this portion. Provide concise key takeaways and preserve critical details.'
        });
        chunkSummaries.push(`### Section ${index + 1}\n${summary}`);
      } catch (err) {
        throw new Error(err?.message || 'Failed to summarize chunk');
      }
    }

    setStatus('Combining sections…');
    const combined = chunkSummaries.join('\n\n');
    const finalSummary = await summarizer.summarize(combined, {
      context: 'You are summarizing multi-part notes produced from a longer article. Create a cohesive Markdown summary with key insights.'
    });
    setSummary(finalSummary);
    setStatus('Summary ready');
  }, []);

  const handleSummarize = React.useCallback(async () => {
    setError('');
    setSummary('');
    setSourceInfo('');
    setStatus('Collecting page text…');
    setIsLoading(true);
    setDownloadProgress(null);
    try {
      const source = await fetchActiveTabText();
      if (!source.text.trim()) {
        throw new Error('No readable text found on the page');
      }
      setSourceInfo(formatSourceLabel(source, 'Current page'));
      const summarizer = await ensureSummarizer();
      await summarizeWithChunks(summarizer, source.text, formatSourceLabel(source, 'Current page'));
      setDownloadProgress(null);
    } catch (err) {
      setError(err?.message || 'Failed to summarize');
      setStatus('');
    } finally {
      setIsLoading(false);
    }
  }, [ensureSummarizer, fetchActiveTabText]);

  const handleSummarizeLink = React.useCallback(async (event) => {
    if (event) {
      event.preventDefault();
    }
    setError('');
    setSummary('');
    setSourceInfo('');
    setStatus('Fetching link…');
    setIsLoading(true);
    setDownloadProgress(null);
    try {
      const source = await fetchUrlText(urlInput);
      setSourceInfo(formatSourceLabel(source, 'Provided link'));
      const summarizer = await ensureSummarizer();
      await summarizeWithChunks(summarizer, source.text, formatSourceLabel(source, 'Provided link'));
      setDownloadProgress(null);
    } catch (err) {
      setError(err?.message || 'Failed to summarize');
      setStatus('');
    } finally {
      setIsLoading(false);
    }
  }, [ensureSummarizer, fetchUrlText, summarizeWithChunks, urlInput]);

  const availabilityLabel = React.useMemo(() => {
    if (!supported) {
      return 'Summarizer API not supported in this environment.';
    }
    switch (availability) {
      case 'checking':
        return 'Checking model availability…';
      case 'available':
        return 'Model ready.';
      case 'downloadable':
        return 'Model download required on first use.';
      case 'unavailable':
        return 'Model unavailable on this device.';
      case 'unsupported':
        return 'Summarizer API unsupported.';
      case 'error':
        return 'Could not determine availability.';
      default:
        return '';
    }
  }, [availability, supported]);

  const linkButtonDisabled = React.useMemo(() => {
    if (!supported || availability === 'unavailable') {
      return true;
    }
    if (isLoading) {
      return true;
    }
    return !urlInput.trim();
  }, [availability, isLoading, supported, urlInput]);

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid var(--border-primary)',
        padding: 16,
        background: 'var(--glass-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 0
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 className="coolDesk-section-title" style={{ margin: 0 }}>AI Tools</h2>
          <button
            type="button"
            onClick={handleSummarize}
            disabled={isLoading || !supported || availability === 'unavailable'}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--interactive)',
              color: 'var(--text-on-interactive)',
              cursor: isLoading || !supported || availability === 'unavailable' ? 'not-allowed' : 'pointer',
              opacity: isLoading || !supported || availability === 'unavailable' ? 0.6 : 1,
              fontWeight: 600
            }}
          >
            {isLoading ? 'Working…' : 'Summarize Current Tab'}
          </button>
        </div>
        <form onSubmit={handleSummarizeLink} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="Paste https:// link to summarize"
            autoComplete="off"
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'rgba(0,0,0,0.2)',
              color: 'var(--text-primary)',
              fontSize: 'var(--font-size-sm)'
            }}
          />
          <button
            type="submit"
            disabled={linkButtonDisabled}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: linkButtonDisabled ? 'rgba(255,255,255,0.1)' : 'var(--interactive)',
              color: 'var(--text-on-interactive)',
              cursor: linkButtonDisabled ? 'not-allowed' : 'pointer',
              opacity: linkButtonDisabled ? 0.6 : 1,
              fontWeight: 600
            }}
          >
            {isLoading ? 'Working…' : 'Summarize Link'}
          </button>
        </form>
      </div>
      {availabilityLabel && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{availabilityLabel}</div>
      )}
      {downloadProgress !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            <span>{status || 'Downloading model…'}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{downloadProgress}%</span>
          </div>
          <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.12)' }}>
            <div
              style={{
                width: `${downloadProgress}%`,
                transition: 'width 0.2s ease',
                borderRadius: 999,
                background: 'var(--interactive)'
              }}
            />
          </div>
        </div>
      )}
      {downloadProgress === null && status && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{status}</div>
      )}
      {error && (
        <div style={{ color: 'var(--danger-text)', fontWeight: 500 }}>{error}</div>
      )}
      {summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{sourceInfo}</div>
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'rgba(0,0,0,0.15)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.5
            }}
          >
            {summary}
          </div>
        </div>
      )}
    </div>
  );
}
