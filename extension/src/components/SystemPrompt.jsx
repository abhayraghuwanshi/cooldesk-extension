import React, { useEffect, useMemo, useState } from 'react';
import { buildEnrichmentPromptForWorkspace } from '../prompts';

// Simple screen to maintain a per-workspace system prompt that can be used by AI features
// Props:
// - workspaceName: string (current workspace name)
// - workspaces: array of workspace objects
// - onSave: function(updatedWorkspace)
export function SystemPrompt({ workspaceName, workspaces, onSave }) {
  const ws = useMemo(() => workspaces.find(w => w?.name === workspaceName) || null, [workspaces, workspaceName]);
  const [prompt, setPrompt] = useState('');
  const defaultPrompt = useMemo(() => buildEnrichmentPromptForWorkspace(workspaceName || 'Workspace', []), [workspaceName]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { total, included }

  useEffect(() => {
    setPrompt(ws?.systemPrompt || defaultPrompt);
  }, [ws, defaultPrompt]);

  const handleSave = async () => {
    if (!ws) return;
    const updated = { ...ws, systemPrompt: prompt };
    await onSave?.(updated);
  };

  const handleCategorize = async () => {
    try {
      setError('');
      setResult(null);
      setRunning(true);
      const urls = Array.isArray(ws?.urls) ? ws.urls.map(u => u?.url).filter(Boolean).slice(0, 100) : [];
      if (urls.length === 0) {
        setError('This workspace has no saved URLs to categorize.');
        setRunning(false);
        return;
      }
      const resp = await chrome.runtime.sendMessage({
        action: 'categorizeWorkspaceUrls',
        workspace: workspaceName,
        urls,
        systemPrompt: prompt,
      });
      if (!resp?.ok) {
        setError(resp?.error || 'Failed to categorize URLs');
        setRunning(false);
        return;
      }
      const results = Array.isArray(resp.results) ? resp.results : [];
      const included = results.filter(r => r.included).length;
      setResult({ total: results.length || urls.length, included });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  if (!workspaceName || workspaceName === 'All') return null;

  return (
    <div className="system-prompt-panel" style={{
      border: '1px solid #273043',
      background: '#121826',
      borderRadius: 12,
      padding: 12,
      margin: '10px 0'
    }}>
      <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.85, fontSize: 12 }}>
        Define guidance for how AI should organize, name, and prioritize links in this workspace.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={defaultPrompt}
        rows={5}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid #273043',
          background: '#1b2331',
          color: '#e5e7eb',
          outline: 'none',
          resize: 'vertical',
          marginBottom: 8,
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, opacity: 0.85, minHeight: 16 }}>
          {running && <span>Running categorization…</span>}
          {!running && error && <span style={{ color: '#f87171' }}>{error}</span>}
          {!running && !error && result && (
            <span>
              Included: {result.included}/{result.total}
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          className="add-link-btn"
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid #273043',
            background: '#1b2331',
            color: '#e5e7eb',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          Save Prompt
        </button>
        <button
          onClick={handleCategorize}
          disabled={running}
          className="add-link-btn"
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid #273043',
            background: running ? '#111827' : '#1b2331',
            color: '#e5e7eb',
            fontSize: 12,
            cursor: running ? 'not-allowed' : 'pointer'
          }}
          title="Send up to 100 workspace URLs to Gemini for inclusion categorization"
        >
          {running ? 'Categorizing…' : 'Categorize URLs'}
        </button>
      </div>
    </div>
  );
}
