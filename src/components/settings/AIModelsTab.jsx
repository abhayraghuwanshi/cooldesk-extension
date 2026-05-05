/**
 * Local AI Models Tab - Settings Component
 * Manages on-device LLM for categorization, summarization, and smart features
 */

import {
    faBolt,
    faCheck,
    faChevronDown,
    faCircleNotch,
    faCloud,
    faDownload,
    faEye,
    faEyeSlash,
    faKey,
    faMemory,
    faMicrochip,
    faRocket,
    faServer,
    faTrash
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';
import { isElectronApp } from '../../services/environmentDetector';

// Sidecar API URL (Tauri desktop app runs sidecar on port 4545)
const SIDECAR_URL = 'http://127.0.0.1:4545';

// Helper to call sidecar HTTP API
async function sidecarGet(path) {
    const res = await fetch(`${SIDECAR_URL}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function sidecarPost(path, data = {}) {
    const res = await fetch(`${SIDECAR_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export default function AIModelsTab() {
    const isDesktopApp = isElectronApp();

    // Local AI State
    const [status, setStatus] = useState(null);
    const [models, setModels] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloadProgress, setDownloadProgress] = useState({});
    const [loadingModel, setLoadingModel] = useState(null);
    const [sidecarAvailable, setSidecarAvailable] = useState(null);
    const [gpuEnabled, setGpuEnabled] = useState(false);
    const [gpuLayers, setGpuLayers] = useState(99);
    const [localAiExpanded, setLocalAiExpanded] = useState(true);

    // Check sidecar availability on mount (for desktop apps)
    useEffect(() => {
        if (!isDesktopApp) {
            setSidecarAvailable(false);
            setLoading(false);
            return;
        }

        let ws = null;
        let mounted = true;

        async function checkSidecar() {
            try {
                const health = await fetch(`${SIDECAR_URL}/health`, { method: 'GET' });
                if (health.ok && mounted) {
                    setSidecarAvailable(true);
                    loadStatus();
                    loadModels();

                    // Connect WebSocket for progress updates
                    ws = new WebSocket(`ws://127.0.0.1:4545`);
                    ws.onopen = () => {
                        ws.send(JSON.stringify({ type: 'identify', client: 'aiModelsTab' }));
                    };
                    ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.type === 'llm-progress' || data.type === 'llm-download-progress') {
                                const { type: progressType, progress, modelName, error: progressError } = data.payload || {};
                                if (progressType === 'download' || data.type === 'llm-download-progress') {
                                    setDownloadProgress(prev => ({ ...prev, [modelName]: progress }));
                                } else if (progressType === 'loading') {
                                    setLoadingModel(modelName);
                                } else if (progressType === 'loaded') {
                                    setLoadingModel(null);
                                    loadStatus();
                                    loadModels();
                                } else if (progressType === 'error') {
                                    setError(progressError || 'Unknown error');
                                    setLoadingModel(null);
                                }
                            } else if (data.type === 'llm-loaded') {
                                setLoadingModel(null);
                                loadStatus();
                                loadModels();
                            } else if (data.type === 'llm-download-complete') {
                                // Download finished - clear progress and refresh
                                const completedModel = data.payload?.modelName;
                                setDownloadProgress(prev => {
                                    const copy = { ...prev };
                                    delete copy[completedModel];
                                    return copy;
                                });
                                loadModels();
                            } else if (data.type === 'llm-download-error') {
                                // Download failed
                                const failedModel = data.payload?.modelName;
                                setDownloadProgress(prev => {
                                    const copy = { ...prev };
                                    delete copy[failedModel];
                                    return copy;
                                });
                                setError(data.payload?.error || 'Download failed');
                            } else if (data.type === 'llm-error') {
                                setError(data.payload?.error || 'Unknown error');
                                setLoadingModel(null);
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    };
                } else if (mounted) {
                    setSidecarAvailable(false);
                    setLoading(false);
                }
            } catch (e) {
                if (mounted) {
                    setSidecarAvailable(false);
                    setLoading(false);
                }
            }
        }

        checkSidecar();

        return () => {
            mounted = false;
            if (ws) ws.close();
        };
    }, [isDesktopApp]);

    const loadStatus = async () => {
        try {
            const s = await sidecarGet('/llm/status');
            setStatus(s);
        } catch (e) {
            setError(e.message);
        }
    };

    const loadModels = async () => {
        setLoading(true);
        try {
            const m = await sidecarGet('/llm/models');
            setModels(m || {});
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (modelName) => {
        setError('');
        setDownloadProgress(prev => ({ ...prev, [modelName]: 0 }));
        try {
            // Fire-and-forget - returns immediately, progress/completion via WebSocket
            await sidecarPost('/llm/download', { modelName });
            // Progress updates and completion/error come via WebSocket
        } catch (e) {
            setError('Failed to start download: ' + e.message);
            setDownloadProgress(prev => {
                const copy = { ...prev };
                delete copy[modelName];
                return copy;
            });
        }
    };

    const handleLoad = async (modelName) => {
        setError('');
        setLoadingModel(modelName);
        try {
            const layers = gpuEnabled ? gpuLayers : 0;
            const result = await sidecarPost('/llm/load', { modelName, gpuLayers: layers });
            if (result && !result.ok && result.error) {
                setError(result.error || 'Failed to load model');
            }
            loadStatus();
            loadModels();
        } catch (e) {
            setError(e.message);
        } finally {
            setLoadingModel(null);
        }
    };

    const handleUnload = async () => {
        setError('');
        try {
            await sidecarPost('/llm/unload');
            loadStatus();
            loadModels();
        } catch (e) {
            setError(e.message);
        }
    };

    const modelList = Object.entries(models).filter(([k]) => !k.startsWith('error'));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Cloud AI */}
            <CloudAISection sidecarAvailable={sidecarAvailable} />

            {/* Error Display */}
            {error && (
                <div style={{
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    fontSize: 13
                }}>
                    {error}
                </div>
            )}

            {/* LOCAL AI SECTION */}
            {isDesktopApp && (
                <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.06)',
                    overflow: 'hidden'
                }}>
                    {/* Section Header */}
                    <div
                        onClick={() => setLocalAiExpanded(!localAiExpanded)}
                        style={{
                            padding: '16px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            cursor: 'pointer',
                            borderBottom: localAiExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none'
                        }}
                    >
                        <div style={{
                            width: 40, height: 40, borderRadius: 12,
                            background: status?.modelLoaded
                                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                                : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff'
                        }}>
                            <FontAwesomeIcon icon={faServer} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                                Local AI Engine
                            </h3>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                                {!sidecarAvailable
                                    ? 'Desktop app required'
                                    : status?.modelLoaded
                                        ? `Active: ${status.currentModel?.replace('.gguf', '').replace(/-/g, ' ')}`
                                        : status?.initialized
                                            ? 'Ready - No model loaded'
                                            : 'Initializing...'}
                            </div>
                        </div>
                        <FontAwesomeIcon
                            icon={faChevronDown}
                            style={{
                                color: '#9ca3af',
                                transition: 'transform 0.2s',
                                transform: localAiExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                            }}
                        />
                    </div>

                    {localAiExpanded && (
                        <div style={{ padding: 20 }}>
                            {/* Sidecar not available message */}
                            {sidecarAvailable === null && (
                                <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.5)' }}>
                                    <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 32, marginBottom: 16 }} />
                                    <p style={{ margin: 0, fontSize: 13 }}>Connecting to AI service...</p>
                                </div>
                            )}

                            {sidecarAvailable === false && (
                                <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.5)' }}>
                                    <FontAwesomeIcon icon={faServer} style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
                                    <h4 style={{ margin: '0 0 8px 0', color: '#fff', fontWeight: 600 }}>Desktop App Required</h4>
                                    <p style={{ margin: 0, fontSize: 13 }}>
                                        Local AI models are only available in the CoolDesk desktop app.
                                        <br />
                                        Ensure the desktop app is running to use on-device AI features.
                                    </p>
                                </div>
                            )}

                            {sidecarAvailable && (
                                <>
                                    {/* Quick Stats */}
                                    <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                                        <div style={{
                                            flex: 1, padding: 12, background: 'rgba(0,0,0,0.2)',
                                            borderRadius: 10, textAlign: 'center'
                                        }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
                                                {modelList.filter(([, m]) => m.downloaded).length}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Downloaded</div>
                                        </div>
                                        <div style={{
                                            flex: 1, padding: 12, background: 'rgba(0,0,0,0.2)',
                                            borderRadius: 10, textAlign: 'center'
                                        }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: status?.modelLoaded ? '#4ade80' : '#fff' }}>
                                                {status?.modelLoaded ? '1' : '0'}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Active</div>
                                        </div>
                                        <div style={{
                                            flex: 1, padding: 12, background: 'rgba(0,0,0,0.2)',
                                            borderRadius: 10, textAlign: 'center'
                                        }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
                                                {modelList.length}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Available</div>
                                        </div>
                                        {status?.modelLoaded && (
                                            <button
                                                onClick={handleUnload}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: 10,
                                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                                    background: 'rgba(239, 68, 68, 0.1)',
                                                    color: '#f87171',
                                                    fontSize: 12,
                                                    cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 6
                                                }}
                                            >
                                                <FontAwesomeIcon icon={faTrash} />
                                                Unload
                                            </button>
                                        )}
                                    </div>

                                    {/* GPU Acceleration */}
                                    <div style={{
                                        padding: 16,
                                        background: 'rgba(0,0,0,0.15)',
                                        borderRadius: 12,
                                        marginBottom: 20
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{
                                                width: 36, height: 36, borderRadius: 10,
                                                background: gpuEnabled
                                                    ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                                    : 'linear-gradient(135deg, #4b5563, #374151)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: '#fff', transition: 'all 0.3s'
                                            }}>
                                                <FontAwesomeIcon icon={faBolt} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                                                    GPU Acceleration
                                                </div>
                                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                                                    {gpuEnabled ? `Offloading ${gpuLayers} layers to GPU` : 'Running on CPU only'}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setGpuEnabled(!gpuEnabled)}
                                                style={{
                                                    width: 44, height: 24, borderRadius: 12, border: 'none',
                                                    background: gpuEnabled ? '#f59e0b' : 'rgba(255,255,255,0.15)',
                                                    cursor: 'pointer', position: 'relative',
                                                    transition: 'background 0.3s'
                                                }}
                                            >
                                                <div style={{
                                                    width: 18, height: 18, borderRadius: 9,
                                                    background: '#fff',
                                                    position: 'absolute', top: 3,
                                                    left: gpuEnabled ? 23 : 3,
                                                    transition: 'left 0.3s',
                                                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                                                }} />
                                            </button>
                                        </div>

                                        {gpuEnabled && (
                                            <div style={{ marginTop: 12 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                                                        <FontAwesomeIcon icon={faMicrochip} style={{ marginRight: 6 }} />
                                                        GPU Layers
                                                    </span>
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>
                                                        {gpuLayers === 99 ? 'All (99)' : gpuLayers}
                                                    </span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="1" max="99"
                                                    value={gpuLayers}
                                                    onChange={(e) => setGpuLayers(Number(e.target.value))}
                                                    style={{
                                                        width: '100%', height: 4,
                                                        borderRadius: 2,
                                                        appearance: 'none',
                                                        background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${gpuLayers}%, rgba(255,255,255,0.1) ${gpuLayers}%, rgba(255,255,255,0.1) 100%)`,
                                                        outline: 'none', cursor: 'pointer'
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Models List */}
                                    <div>
                                        <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                                            Available Models
                                        </h4>

                                        {loading ? (
                                            <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.5)' }}>
                                                <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 20 }} />
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                {modelList.map(([filename, model]) => (
                                                    <ModelCard
                                                        key={filename}
                                                        filename={filename}
                                                        model={model}
                                                        isLoaded={status?.currentModel === filename}
                                                        isLoading={loadingModel === filename}
                                                        downloadProgress={downloadProgress[filename]}
                                                        onDownload={() => handleDownload(filename)}
                                                        onLoad={() => handleLoad(filename)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Info Section */}
            <div style={{
                padding: 16,
                background: 'rgba(139, 92, 246, 0.08)',
                borderRadius: 12,
                border: '1px solid rgba(139, 92, 246, 0.15)',
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)'
            }}>
                <strong style={{ color: '#a78bfa' }}>Local AI Features:</strong>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
                    <li><strong>Private:</strong> All processing happens on your device - no data sent to cloud</li>
                    <li><strong>Offline:</strong> Works without internet connection once model is downloaded</li>
                    <li><strong>Powers:</strong> URL categorization, summarization, workspace suggestions, smart search</li>
                </ul>
            </div>
        </div>
    );
}

// =============================================================================
// CLOUD AI SECTION
// =============================================================================

const PROVIDER_MODELS = {
    openai: [
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini — fast & cheap (recommended)' },
        { value: 'gpt-4o',      label: 'GPT-4o — most capable' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
    anthropic: [
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest, lowest cost' },
        { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — balanced' },
        { value: 'claude-opus-4-7',           label: 'Claude Opus 4.7 — most capable' },
    ],
    gemini: [
        { value: 'gemini-2.5-flash',            label: 'Gemini 2.5 Flash — fast, stable (recommended)' },
        { value: 'gemini-2.5-flash-lite',        label: 'Gemini 2.5 Flash Lite — cheapest, stable' },
        { value: 'gemini-3-flash-preview',       label: 'Gemini 3 Flash Preview — latest (preview)' },
        { value: 'gemini-3.1-pro-preview',       label: 'Gemini 3.1 Pro Preview — most capable (preview)' },
        { value: 'gemini-3.1-flash-lite-preview',label: 'Gemini 3.1 Flash Lite Preview — fast (preview)' },
    ],
};

function CloudAISection({ sidecarAvailable }) {
    const [provider, setProvider] = useState('openai');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('gpt-4o-mini');
    const [showKey, setShowKey] = useState(false);
    const [configStatus, setConfigStatus] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState(null);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [expanded, setExpanded] = useState(true);

    useEffect(() => {
        if (!sidecarAvailable) return;
        fetch(`${SIDECAR_URL}/llm/v3/config`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                setConfigStatus(data);
                setProvider(data.provider || 'openai');
                setModel(data.model || 'gpt-4o-mini');
            })
            .catch(() => {});
    }, [sidecarAvailable]);

    const handleSave = async () => {
        setSaving(true);
        setSaveMsg(null);
        try {
            const body = { provider, model };
            if (apiKey.trim()) body.apiKey = apiKey.trim();
            const res = await fetch(`${SIDECAR_URL}/llm/v3/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            setSaveMsg({ ok: data.ok, text: data.ok ? 'Saved!' : (data.error || 'Save failed') });
            if (data.ok) {
                setApiKey('');
                const s = await fetch(`${SIDECAR_URL}/llm/v3/config`).then(r => r.json()).catch(() => null);
                if (s) setConfigStatus(s);
            }
        } catch (e) {
            setSaveMsg({ ok: false, text: e.message });
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMsg(null), 3000);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch(`${SIDECAR_URL}/llm/v3/simple-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Reply with exactly two words: Connection OK' }),
            });
            const data = await res.json();
            setTestResult({ ok: data.ok, text: data.ok ? `✓ ${data.response?.slice(0, 80)}` : (data.error || 'Failed') });
        } catch (e) {
            setTestResult({ ok: false, text: e.message });
        } finally {
            setTesting(false);
            setTimeout(() => setTestResult(null), 5000);
        }
    };

    const isConfigured = configStatus?.configured;

    return (
        <div style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 16,
            border: isConfigured
                ? '1px solid rgba(139, 92, 246, 0.3)'
                : '1px solid rgba(255,255,255,0.06)',
            overflow: 'hidden',
        }}>
            {/* Header (collapsible) */}
            <div
                onClick={() => setExpanded(v => !v)}
                style={{
                    padding: '16px 20px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    cursor: 'pointer',
                    borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}
            >
                <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: isConfigured
                        ? 'linear-gradient(135deg, #8b5cf6, #6366f1)'
                        : 'linear-gradient(135deg, #4b5563, #374151)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', transition: 'background 0.3s', flexShrink: 0,
                }}>
                    <FontAwesomeIcon icon={faCloud} />
                </div>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#fff' }}>Cloud AI</h3>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                        {isConfigured
                            ? `${{ openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini' }[configStatus.provider] || configStatus.provider} · ${configStatus.model} · ${configStatus.apiKeyMasked}`
                            : 'Connect OpenAI, Anthropic, or Gemini for smarter AI'}
                    </div>
                </div>
                {isConfigured && (
                    <span style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 6,
                        background: 'rgba(139,92,246,0.2)', color: '#c4b5fd',
                        marginRight: 8,
                    }}>
                        CONFIGURED
                    </span>
                )}
                <FontAwesomeIcon
                    icon={faChevronDown}
                    style={{
                        color: '#9ca3af', transition: 'transform 0.2s',
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                />
            </div>

            {expanded && (
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Provider + Model */}
                    <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Provider
                            </label>
                            <select
                                value={provider}
                                onChange={e => {
                                    setProvider(e.target.value);
                                    const defaults = { openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001', gemini: 'gemini-2.5-flash' };
                                    setModel(defaults[e.target.value] || 'gpt-4o-mini');
                                }}
                                style={{
                                    width: '100%', padding: '8px 10px', borderRadius: 8,
                                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer',
                                }}
                            >
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic</option>
                                <option value="gemini">Google Gemini</option>
                            </select>
                        </div>
                        <div style={{ flex: 2 }}>
                            <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Model
                            </label>
                            <select
                                value={model}
                                onChange={e => setModel(e.target.value)}
                                style={{
                                    width: '100%', padding: '8px 10px', borderRadius: 8,
                                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer',
                                }}
                            >
                                {(PROVIDER_MODELS[provider] || PROVIDER_MODELS.openai).map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* API Key */}
                    <div>
                        <label style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            <FontAwesomeIcon icon={faKey} style={{ marginRight: 5 }} />
                            API Key {isConfigured && <span style={{ color: 'rgba(255,255,255,0.25)', textTransform: 'none' }}>— leave blank to keep current</span>}
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showKey ? 'text' : 'password'}
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                                placeholder={isConfigured ? configStatus.apiKeyMasked : (provider === 'anthropic' ? 'sk-ant-...' : 'sk-...')}
                                style={{
                                    width: '100%', padding: '8px 36px 8px 10px', borderRadius: 8,
                                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                                }}
                            />
                            <button
                                onClick={() => setShowKey(v => !v)}
                                style={{
                                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
                                    cursor: 'pointer', padding: 4, fontSize: 12,
                                }}
                            >
                                <FontAwesomeIcon icon={showKey ? faEyeSlash : faEye} />
                            </button>
                        </div>
                    </div>

                    {/* Buttons row */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                            onClick={handleSave}
                            disabled={saving || (!apiKey.trim() && !isConfigured)}
                            style={{
                                padding: '8px 18px', borderRadius: 8, border: 'none',
                                background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                                opacity: (saving || (!apiKey.trim() && !isConfigured)) ? 0.45 : 1,
                                display: 'flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            {saving
                                ? <><FontAwesomeIcon icon={faCircleNotch} spin /> Saving...</>
                                : <><FontAwesomeIcon icon={faCheck} /> Save</>}
                        </button>

                        {isConfigured && (
                            <button
                                onClick={handleTest}
                                disabled={testing}
                                style={{
                                    padding: '8px 14px', borderRadius: 8,
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    background: 'rgba(255,255,255,0.04)',
                                    color: '#fff', fontSize: 13, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                            >
                                {testing ? <><FontAwesomeIcon icon={faCircleNotch} spin /> Testing...</> : 'Test Connection'}
                            </button>
                        )}

                        {saveMsg && (
                            <span style={{ fontSize: 13, color: saveMsg.ok ? '#4ade80' : '#f87171' }}>
                                {saveMsg.text}
                            </span>
                        )}
                    </div>

                    {/* Test result */}
                    {testResult && (
                        <div style={{
                            padding: '9px 12px', borderRadius: 8, fontSize: 13,
                            background: testResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                            border: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                            color: testResult.ok ? '#4ade80' : '#f87171',
                        }}>
                            {testResult.text}
                        </div>
                    )}

                    {/* First-time hint */}
                    {!isConfigured && (
                        <div style={{
                            padding: '10px 12px', borderRadius: 8, fontSize: 12,
                            background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)',
                            color: 'rgba(255,255,255,0.45)', lineHeight: 1.55,
                        }}>
                            Get your key from{' '}
                            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>
                                platform.openai.com
                            </a>{' '}(OpenAI) or{' '}
                            <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>
                                console.anthropic.com
                            </a>{' '}(Anthropic). Keys are stored locally on your device.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// =============================================================================

// Model Card Component
function ModelCard({ filename, model, isLoaded, isLoading, downloadProgress, onDownload, onLoad }) {
    const isDownloading = downloadProgress !== undefined;

    const getQualityColor = (quality) => {
        switch (quality?.toLowerCase()) {
            case 'high': return '#22c55e';
            case 'good': return '#3b82f6';
            case 'basic': return '#f59e0b';
            default: return '#9ca3af';
        }
    };

    return (
        <div style={{
            padding: 14,
            background: isLoaded ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: isLoaded ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(255,255,255,0.04)',
            transition: 'all 0.2s'
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Icon */}
                <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: isLoaded
                        ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                        : model.downloaded
                            ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                            : 'rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 16, flexShrink: 0
                }}>
                    <FontAwesomeIcon icon={isLoaded ? faRocket : faMemory} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>
                            {model.name}
                        </span>
                        {isLoaded && (
                            <span style={{
                                fontSize: 9, padding: '2px 5px', borderRadius: 4,
                                background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80'
                            }}>
                                ACTIVE
                            </span>
                        )}
                        <span style={{
                            fontSize: 9, padding: '2px 5px', borderRadius: 4,
                            background: `${getQualityColor(model.quality)}20`,
                            color: getQualityColor(model.quality)
                        }}>
                            {model.quality}
                        </span>
                    </div>

                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                        {model.description}
                    </div>

                    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                        <span>Size: {model.size}</span>
                        <span>RAM: {model.ram}</span>
                        <span>Speed: {model.speed}</span>
                    </div>

                    {/* Download Progress */}
                    {isDownloading && (
                        <div style={{ marginTop: 8 }}>
                            <div style={{
                                height: 3, borderRadius: 2,
                                background: 'rgba(255,255,255,0.1)',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    height: '100%', borderRadius: 2,
                                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                                    width: `${downloadProgress}%`,
                                    transition: 'width 0.3s'
                                }} />
                            </div>
                            <div style={{ fontSize: 10, color: '#60a5fa', marginTop: 3 }}>
                                Downloading... {downloadProgress}%
                            </div>
                        </div>
                    )}
                </div>

                {/* Action Button */}
                <div style={{ flexShrink: 0 }}>
                    {!model.downloaded ? (
                        <button
                            onClick={onDownload}
                            disabled={isDownloading}
                            style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: 'none',
                                background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                                color: '#fff',
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: isDownloading ? 'wait' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 5,
                                opacity: isDownloading ? 0.7 : 1
                            }}
                        >
                            {isDownloading ? (
                                <FontAwesomeIcon icon={faCircleNotch} spin />
                            ) : (
                                <FontAwesomeIcon icon={faDownload} />
                            )}
                            {isDownloading ? 'Downloading' : 'Download'}
                        </button>
                    ) : isLoaded ? (
                        <div style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'rgba(34, 197, 94, 0.15)',
                            color: '#4ade80',
                            fontSize: 11,
                            fontWeight: 500
                        }}>
                            In Use
                        </div>
                    ) : (
                        <button
                            onClick={onLoad}
                            disabled={isLoading}
                            style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.04)',
                                color: '#fff',
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: isLoading ? 'wait' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 5
                            }}
                        >
                            {isLoading ? (
                                <>
                                    <FontAwesomeIcon icon={faCircleNotch} spin />
                                    Loading
                                </>
                            ) : (
                                <>
                                    <FontAwesomeIcon icon={faRocket} />
                                    Load
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
