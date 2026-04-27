import {
  faTimes,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useRef, useState } from 'react';
import { safeGetHostname } from '../../../utils/helpers';
import { buildSyncContext, invalidateSyncContext } from '../../../services/syncContextService';
import { runningAppsService } from '../../../services/runningAppsService';
import WorkspaceSidebar from './WorkspaceSidebar';
import WorkspaceEditor from './WorkspaceEditor';
import AISuggestionPanel from './AISuggestionPanel';
import AIPromptBar from './AIPromptBar';
import { useBrowserData } from './useBrowserData';
import { useAISuggestions } from './useAISuggestions';
import { useWorkspaceAgent } from './useWorkspaceAgent';
import { useMemory } from './useMemory';
import './AIWorkspaceManager.css';

export default function AIWorkspaceManager({
  workspaces = [],
  onSave,
  onDelete,
  isOpen: externalIsOpen,
  onOpen: externalOnOpen,
  onClose: externalOnClose,
  initialWorkspace,
  showFab = true,
  ...rest
}) {
  // Controlled / uncontrolled open state
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isControlled = externalIsOpen !== undefined;
  const isOpen = isControlled ? externalIsOpen : internalIsOpen;

  const handleOpen = useCallback(() => {
    if (isControlled) externalOnOpen?.();
    else setInternalIsOpen(true);
  }, [isControlled, externalOnOpen]);

  const handleClose = useCallback(() => {
    if (isControlled) externalOnClose?.();
    else setInternalIsOpen(false);
  }, [isControlled, externalOnClose]);

  // ── Core state ────────────────────────────────────────────────────────────
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  const [mode, setMode] = useState('suggestions'); // 'suggestions' | 'edit' | 'create'

  const [formData, setFormData] = useState({
    id: null, name: '', icon: 'folder', description: '', urls: [], apps: [], createdAt: null
  });

  // AI-suggested URLs shown inside the WorkspaceEditor
  const [relatedUrls, setRelatedUrls] = useState([]);
  const [relatedUrlsLoading, setRelatedUrlsLoading] = useState(false);

  // Memory + sync context
  const [memoryContext, setMemoryContext] = useState('');
  const [syncContext, setSyncContext]     = useState('');

  // ── Running apps (desktop) ────────────────────────────────────────────────
  const [runningApps, setRunningApps]     = useState([]);
  const [installedApps, setInstalledApps] = useState([]);

  useEffect(() => {
    const unsub = runningAppsService.subscribe(({ runningApps: r, installedApps: i }) => {
      setRunningApps(r || []);
      setInstalledApps(i || []);
    });
    return unsub;
  }, []);

  // ── Browser data ──────────────────────────────────────────────────────────
  const { tabs, history, bookmarks, isLoading: browserDataLoading } = useBrowserData(isOpen);

  // ── Agent: three-tool workspace builder ───────────────────────────────────
  const { suggestWorkspaces, resolveAcceptedGroup } = useWorkspaceAgent();
  const [agentSuggestions, setAgentSuggestions] = useState([]);
  const [agentLoading, setAgentLoading]         = useState(false);
  const [agentError, setAgentError]             = useState(null);

  // ── useAISuggestions: only used for workspace-context prompts (edit mode) ─
  const {
    aiPrompt,
    setAiPrompt,
    suggestions: contextSuggestions,
    isLoading: contextLoading,
    error: contextError,
    generateSuggestions,
    suggestRelatedUrls
  } = useAISuggestions(tabs, workspaces);

  // ── Memory ────────────────────────────────────────────────────────────────
  const memory = useMemory();

  // ── Fetch sync context once on open ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    buildSyncContext().then(ctx => setSyncContext(ctx));
  }, [isOpen]);

  // Reset suggestions when dialog closes so re-opening starts fresh
  useEffect(() => {
    if (!isOpen) {
      setAgentSuggestions([]);
      setAgentError(null);
    }
  }, [isOpen]);

  // ── Record ignored suggestions on close ──────────────────────────────────
  const agentSuggestionsRef = useRef(agentSuggestions);
  useEffect(() => { agentSuggestionsRef.current = agentSuggestions; }, [agentSuggestions]);

  useEffect(() => {
    if (!isOpen && agentSuggestionsRef.current.length > 0) {
      memory.recordIgnoredSuggestions(agentSuggestionsRef.current);
    }
  }, [isOpen]);

  // ── Pipe workspace-context prompt results into relatedUrls ────────────────
  const lastPromptHadWorkspaceContext = useRef(false);
  useEffect(() => {
    if (!lastPromptHadWorkspaceContext.current) return;
    if (contextSuggestions.length === 0) return;

    const newSuggested = contextSuggestions
      .flatMap(g => g.suggestedUrls || [])
      .filter(su => su?.url)
      .map(su => ({
        url: su.url,
        title: su.title || safeGetHostname(su.url),
        reason: su.reason || 'AI suggested',
        _aiSuggested: true
      }));

    if (newSuggested.length > 0) {
      setRelatedUrls(prev => {
        const existing = new Set(prev.map(u => u.url));
        return [...prev, ...newSuggested.filter(u => !existing.has(u.url))];
      });
    }
  }, [contextSuggestions]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape' && isOpen) handleClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // ── Initialize from props ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    if (initialWorkspace) {
      setSelectedWorkspaceId(initialWorkspace.id);
      setMode('edit');
      setFormData({
        id: initialWorkspace.id,
        name: initialWorkspace.name || '',
        icon: initialWorkspace.icon || 'folder',
        description: initialWorkspace.description || '',
        urls: initialWorkspace.urls || [],
        apps: initialWorkspace.apps || [],
        createdAt: initialWorkspace.createdAt || Date.now()
      });
    } else {
      setSelectedWorkspaceId(null);
      setMode('suggestions');
      resetForm();
    }
  }, [isOpen, initialWorkspace]);

  // ── Load workspace when sidebar selection changes ─────────────────────────
  useEffect(() => {
    setRelatedUrls([]);
    setRelatedUrlsLoading(false);

    if (selectedWorkspaceId && mode === 'edit') {
      const workspace = workspaces.find(ws => ws.id === selectedWorkspaceId);
      if (workspace) {
        setFormData({
          id: workspace.id,
          name: workspace.name || '',
          icon: workspace.icon || 'folder',
          description: workspace.description || '',
          urls: workspace.urls || [],
          apps: workspace.apps || [],
          createdAt: workspace.createdAt || Date.now()
        });

        if (workspace.urls?.length > 0) {
          setRelatedUrlsLoading(true);
          suggestRelatedUrls(workspace, history, bookmarks)
            .then(urls => setRelatedUrls(urls))
            .catch(() => setRelatedUrls([]))
            .finally(() => setRelatedUrlsLoading(false));
        }
      }
    }
  }, [selectedWorkspaceId, mode, workspaces, suggestRelatedUrls, history, bookmarks]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setFormData({ id: null, name: '', icon: 'folder', description: '', urls: [], apps: [], createdAt: null });
  }, []);

  const handleShowSuggestions = useCallback(() => {
    setSelectedWorkspaceId(null);
    setMode('suggestions');
    resetForm();
  }, [resetForm]);

  const handleSelectWorkspace = useCallback((workspace) => {
    setSelectedWorkspaceId(workspace.id);
    setMode('edit');
  }, []);

  const handleCreateNew = useCallback(() => {
    setSelectedWorkspaceId(null);
    setMode('create');
    resetForm();
  }, [resetForm]);

  // Accept a suggestion from the agent panel
  const handleAcceptSuggestion = useCallback((group) => {
    memory.recordAcceptedSuggestion(group, tabs);
    setMode('create');
    setSelectedWorkspaceId(null);

    // Resolve URLs + apps + folders using the agent's resolver
    const { urls, apps } = resolveAcceptedGroup(group);

    setFormData({
      id: null,
      name: group.name || '',
      icon: 'folder',
      description: group.description || '',
      urls,
      apps,
      createdAt: null
    });
  }, [tabs, memory, resolveAcceptedGroup]);

  const handleSave = useCallback(async () => {
    if (!formData.name.trim()) return;

    const workspaceData = {
      ...formData,
      id: formData.id || `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      updatedAt: Date.now(),
      createdAt: formData.createdAt || Date.now()
    };

    try {
      await onSave?.(workspaceData);
      memory.recordWorkspaceSaved(workspaceData);
      invalidateSyncContext();
      handleClose();
    } catch (err) {
      console.error('Failed to save workspace:', err);
    }
  }, [formData, onSave, handleClose, memory]);

  const handleDelete = useCallback(async () => {
    if (!formData.id) return;
    const confirmed = window.confirm(`Delete workspace "${formData.name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await onDelete?.(formData.id);
      handleClose();
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  }, [formData.id, formData.name, onDelete, handleClose]);

  const handleAddItems = useCallback(({ urls = [], apps = [] }) => {
    const existingUrls = new Set(formData.urls.map(u => u.url));
    const uniqueNewUrls = urls.filter(u => !existingUrls.has(u.url));

    const getAppKey = (a) => `${a.path}|${a.appType || 'default'}`;
    const existingAppKeys = new Set((formData.apps || []).map(getAppKey));
    const uniqueNewApps = apps.filter(a => !existingAppKeys.has(getAppKey(a)));

    setFormData(prev => ({
      ...prev,
      urls: [...prev.urls, ...uniqueNewUrls],
      apps: [...(prev.apps || []), ...uniqueNewApps]
    }));

    if (formData.name && uniqueNewUrls.length > 0) {
      memory.recordUrlsAddedToWorkspace(uniqueNewUrls, formData.name);
    }
  }, [formData.urls, formData.apps, formData.name, memory]);

  const handleRemoveUrl = useCallback((urlToRemove) => {
    setFormData(prev => ({ ...prev, urls: prev.urls.filter(u => u.url !== urlToRemove) }));
  }, []);

  const handleRemoveApp = useCallback((appToRemove) => {
    setFormData(prev => ({
      ...prev,
      apps: (prev.apps || []).filter(a => !(a.path === appToRemove.path && a.appType === appToRemove.appType))
    }));
  }, []);

  const handleUpdateForm = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Prompt bar submit handler
  const handlePromptSubmit = useCallback(async (promptText) => {
    const ctx = await memory.loadMemoryContext(tabs);
    setMemoryContext(ctx);

    if (mode === 'suggestions') {
      // Run the full three-tool agent with the user's prompt
      setAgentLoading(true);
      setAgentError(null);
      try {
        const groups = await suggestWorkspaces({
          tabs, history, bookmarks,
          runningApps, installedApps,
          customPrompt: promptText,
          syncContext,
          memoryContext: ctx
        });
        setAgentSuggestions(groups);
      } catch (err) {
        setAgentError(err.message);
        setAgentSuggestions([]);
      } finally {
        setAgentLoading(false);
      }
    } else {
      // Workspace context: find related URLs for the current workspace
      const wsContext = formData.name ? formData : null;
      lastPromptHadWorkspaceContext.current = !!wsContext;
      generateSuggestions(promptText, ctx, wsContext, syncContext);
    }
  }, [
    memory, tabs, mode, formData, syncContext,
    suggestWorkspaces, history, bookmarks, runningApps, installedApps,
    generateSuggestions
  ]);

  if (!isOpen) return null;

  const isLoading = mode === 'suggestions'
    ? agentLoading || browserDataLoading
    : contextLoading;

  const currentError = mode === 'suggestions' ? agentError : contextError;

  return (
    <div className="ai-workspace-manager-overlay" onClick={handleClose}>
      <div className="ai-workspace-manager" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="awm-header">
          <h2>
            <FontAwesomeIcon icon={faWandMagicSparkles} className="awm-header-icon" />
            AI Workspace Manager
          </h2>
          <button className="awm-close-btn" onClick={handleClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="awm-content">
          {/* Left Panel */}
          <WorkspaceSidebar
            workspaces={workspaces}
            selectedId={selectedWorkspaceId}
            onSelect={handleSelectWorkspace}
            onCreateNew={handleCreateNew}
            onShowSuggestions={handleShowSuggestions}
            isSuggestionsMode={mode === 'suggestions'}
          />

          {/* Right Panel */}
          <div className="awm-main-panel">
            <AIPromptBar
              value={aiPrompt}
              onChange={setAiPrompt}
              onSubmit={handlePromptSubmit}
              isLoading={isLoading}
              mode={mode}
              workspaceName={formData.name}
            />

            <div className="awm-main-content">
              {mode === 'suggestions' ? (
                <AISuggestionPanel
                  suggestions={agentSuggestions}
                  isLoading={agentLoading || browserDataLoading}
                  error={agentError}
                  onAccept={handleAcceptSuggestion}
                  onCreateNew={handleCreateNew}
                />
              ) : (
                <WorkspaceEditor
                  formData={formData}
                  onUpdate={handleUpdateForm}
                  onRemoveUrl={handleRemoveUrl}
                  onRemoveApp={handleRemoveApp}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  isNewWorkspace={mode === 'create'}
                  tabs={tabs}
                  history={history}
                  bookmarks={bookmarks}
                  relatedUrls={relatedUrls}
                  relatedUrlsLoading={relatedUrlsLoading || contextLoading}
                  aiError={currentError}
                  onAddItem={handleAddItems}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
