import React, { useEffect, useMemo, useState } from 'react';

// Simple screen to maintain a per-workspace system prompt that can be used by AI features
// Props:
// - workspaceName: string (current workspace name)
// - workspaces: array of workspace objects
// - onSave: function(updatedWorkspace)
export function SystemPrompt({ workspaceName, workspaces, onSave }) {
  const ws = useMemo(() => workspaces.find(w => w?.name === workspaceName) || null, [workspaces, workspaceName]);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    setPrompt(ws?.systemPrompt || '');
  }, [ws]);

  const handleSave = async () => {
    if (!ws) return;
    const updated = { ...ws, systemPrompt: prompt };
    await onSave?.(updated);
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
        placeholder="e.g. Group links by documentation, tutorials, tools. Prioritize official docs. Use concise titles."
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
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
      </div>
    </div>
  );
}
