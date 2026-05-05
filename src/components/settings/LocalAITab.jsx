/**
 * Local AI Models Tab - Settings Component
 * Works with both Tauri (sidecar) and Electron desktop apps
 * Manages local LLM download, loading, and configuration
 */

import { faBolt, faCheck, faCircleNotch, faCloud, faDownload, faEye, faEyeSlash, faKey, faMemory, faMicrochip, faRocket, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useState } from 'react';

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

export default function LocalAITab() {
    const [status, setStatus] = useState(null);
    const [models, setModels] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloadProgress, setDownloadProgress] = useState({});
    const [loadingModel, setLoadingModel] = useState(null);
    const [sidecarAvailable, setSidecarAvailable] = useState(null); // null = checking, true/false = result
    const [gpuEnabled, setGpuEnabled] = useState(false);
    const [gpuLayers, setGpuLayers] = useState(99); // 99 = offload all layers

    // Check sidecar availability on mount
    useEffect(() => {
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
                        ws.send(JSON.stringify({ type: 'identify', client: 'localAITab' }));
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
                }
            } catch (e) {
                if (mounted) {
                    setSidecarAvailable(false);
                }
            }
        }

        checkSidecar();

        return () => {
            mounted = false;
            if (ws) ws.close();
        };
    }, []);

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
            const result = await sidecarPost('/llm/download', { modelName });
            if (result && !result.ok && result.error) {
                setError(result.error || 'Download failed');
            } else {
                loadModels();
            }
        } catch (e) {
            setError(e.message);
        } finally {
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

    // Still checking sidecar availability
    if (sidecarAvailable === null) {
        return (
            <div style={{
                padding: 32,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.5)'
            }}>
                <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 32, marginBottom: 16 }} />
                <p style={{ margin: 0, fontSize: 13 }}>Connecting to AI service...</p>
            </div>
        );
    }

    // Sidecar not available - show message
    if (!sidecarAvailable) {
        return (
            <div style={{
                padding: 32,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.5)'
            }}>
                <FontAwesomeIcon icon={faCloud} style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
                <h3 style={{ margin: '0 0 8px 0', color: '#fff', fontWeight: 600 }}>Desktop App Required</h3>
                <p style={{ margin: 0, fontSize: 13 }}>
                    Local AI models are only available in the CoolDesk desktop app.
                    <br />
                    Ensure the desktop app is running to use on-device AI features.
                </p>
            </div>
        );
    }

    const modelList = Object.entries(models).filter(([k]) => !k.startsWith('error'));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Cloud AI Section — always shown */}
            <CloudAISection sidecarAvailable={sidecarAvailable} />

            {/* Status Card */}
            <div style={{
                padding: 20,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.06)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: 12,
                        background: status?.modelLoaded
                            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                            : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff'
                    }}>
                        <FontAwesomeIcon icon={faRocket} />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                            Local AI Engine
                        </h3>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                            {status?.modelLoaded
                                ? `Active: ${status.currentModel?.replace('.gguf', '').replace(/-/g, ' ')}`
                                : status?.initialized
                                    ? 'Ready - No model loaded'
                                    : 'Initializing...'}
                        </div>
                    </div>
                    {status?.modelLoaded && (
                        <button
                            onClick={handleUnload}
                            style={{
                                marginLeft: 'auto',
                                padding: '6px 12px',
                                borderRadius: 8,
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

                {/* Quick Stats */}
                <div style={{ display: 'flex', gap: 16 }}>
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
                </div>
            </div>

            {/* GPU Acceleration Settings */}
            <div style={{
                padding: 20,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.06)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: 12,
                        background: gpuEnabled
                            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                            : 'linear-gradient(135deg, #4b5563, #374151)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', transition: 'all 0.3s'
                    }}>
                        <FontAwesomeIcon icon={faBolt} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                            GPU Acceleration
                        </h3>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                            {gpuEnabled ? `Offloading ${gpuLayers} layers to GPU` : 'Running on CPU only'}
                        </div>
                    </div>
                    <button
                        onClick={() => setGpuEnabled(!gpuEnabled)}
                        style={{
                            width: 48, height: 26, borderRadius: 13, border: 'none',
                            background: gpuEnabled ? '#f59e0b' : 'rgba(255,255,255,0.15)',
                            cursor: 'pointer', position: 'relative',
                            transition: 'background 0.3s'
                        }}
                    >
                        <div style={{
                            width: 20, height: 20, borderRadius: 10,
                            background: '#fff',
                            position: 'absolute', top: 3,
                            left: gpuEnabled ? 25 : 3,
                            transition: 'left 0.3s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                        }} />
                    </button>
                </div>

                {gpuEnabled && (
                    <div style={{
                        padding: 16, background: 'rgba(0,0,0,0.2)',
                        borderRadius: 12
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                                <FontAwesomeIcon icon={faMicrochip} style={{ marginRight: 6 }} />
                                GPU Layers
                            </label>
                            <span style={{
                                fontSize: 13, fontWeight: 600,
                                color: '#f59e0b'
                            }}>
                                {gpuLayers === 99 ? 'All (99)' : gpuLayers}
                            </span>
                        </div>
                        <input
                            type="range"
                            min="1" max="99"
                            value={gpuLayers}
                            onChange={(e) => setGpuLayers(Number(e.target.value))}
                            style={{
                                width: '100%', height: 6,
                                borderRadius: 3,
                                appearance: 'none',
                                background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${gpuLayers}%, rgba(255,255,255,0.1) ${gpuLayers}%, rgba(255,255,255,0.1) 100%)`,
                                outline: 'none', cursor: 'pointer'
                            }}
                        />
                        <div style={{
                            display: 'flex', justifyContent: 'space-between',
                            fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4
                        }}>
                            <span>Less VRAM</span>
                            <span>More VRAM (faster)</span>
                        </div>
                        <div style={{
                            marginTop: 12, padding: '8px 12px',
                            background: 'rgba(245, 158, 11, 0.1)',
                            borderRadius: 8, border: '1px solid rgba(245, 158, 11, 0.2)',
                            fontSize: 12, color: 'rgba(255,255,255,0.6)'
                        }}>
                            💡 Set to <strong style={{ color: '#f59e0b' }}>99</strong> to offload all layers.
                            Lower if you get out-of-memory errors. Requires CUDA/Vulkan GPU.
                        </div>
                    </div>
                )}
            </div>

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

            {/* Models List */}
            <div>
                <h4 style={{ margin: '0 0 16px 0', fontSize: 14, fontWeight: 600, color: '#fff' }}>
                    Available Models
                </h4>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.5)' }}>
                        <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 24 }} />
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

            {/* Info Section */}
            <div style={{
                padding: 16,
                background: 'rgba(59, 130, 246, 0.1)',
                borderRadius: 12,
                border: '1px solid rgba(59, 130, 246, 0.2)',
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)'
            }}>
                <strong style={{ color: '#60a5fa' }}>How it works:</strong>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
                    <li>Models run 100% locally on your device - no internet required</li>
                    <li>Download once, use offline forever</li>
                    <li>Powers: URL categorization, summarization, smart search</li>
                    <li>Recommended: Start with Phi-3 Mini for best balance</li>
                </ul>
            </div>
        </div>
    );
}

// =============================================================================
// CLOUD AI SECTION
// =============================================================================

const SIDECAR_URL = 'http://127.0.0.1:4545';

const OPENAI_MODELS = [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini — fast, cheap, great for most tasks' },
    { value: 'gpt-4o',      label: 'GPT-4o — more capable, higher cost' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
];

const ANTHROPIC_MODELS = [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku — fastest, lowest cost' },
    { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet — balanced' },
];

function CloudAISection({ sidecarAvailable }) {
    const [provider, setProvider] = useState('openai');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('gpt-4o-mini');
    const [showKey, setShowKey] = useState(false);
    const [status, setStatus] = useState(null); // {configured, apiKeyMasked, model, provider}
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState(null); // {ok, text}
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    useEffect(() => {
        if (!sidecarAvailable) return;
        fetch(`${SIDECAR_URL}/llm/v3/config`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                setStatus(data);
                setProvider(data.provider || 'openai');
                setModel(data.model || 'gpt-4o-mini');
                // Don't pre-fill the key input — user must re-enter to change
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
            setSaveMsg({ ok: data.ok, text: data.ok ? 'Saved!' : data.error || 'Save failed' });
            if (data.ok) {
                setApiKey('');
                // Refresh status
                const s = await fetch(`${SIDECAR_URL}/llm/v3/config`).then(r => r.json()).catch(() => null);
                if (s) setStatus(s);
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
                body: JSON.stringify({ message: 'Reply with exactly: "Connection OK"' }),
            });
            const data = await res.json();
            setTestResult({ ok: data.ok, text: data.ok ? `✓ ${data.response?.slice(0, 80)}` : data.error });
        } catch (e) {
            setTestResult({ ok: false, text: e.message });
        } finally {
            setTesting(false);
            setTimeout(() => setTestResult(null), 5000);
        }
    };

    const modelOptions = provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;
    const isConfigured = status?.configured;

    return (
        <div style={{
            padding: 20,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 16,
            border: isConfigured
                ? '1px solid rgba(139, 92, 246, 0.35)'
                : '1px solid rgba(255,255,255,0.06)',
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: isConfigured
                        ? 'linear-gradient(135deg, #8b5cf6, #6366f1)'
                        : 'linear-gradient(135deg, #4b5563, #374151)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', transition: 'background 0.3s',
                }}>
                    <FontAwesomeIcon icon={faCloud} />
                </div>
                <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' }}>
                        Cloud AI
                    </h3>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                        {isConfigured
                            ? `${status.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · ${status.model} · ${status.apiKeyMasked}`
                            : 'Connect OpenAI or Anthropic for smarter AI features'}
                    </div>
                </div>
                {isConfigured && (
                    <span style={{
                        marginLeft: 'auto', fontSize: 11, padding: '3px 8px', borderRadius: 6,
                        background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd',
                    }}>
                        CONFIGURED
                    </span>
                )}
            </div>

            {/* Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Provider + Model row */}
                <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                            Provider
                        </label>
                        <select
                            value={provider}
                            onChange={e => {
                                setProvider(e.target.value);
                                setModel(e.target.value === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini');
                            }}
                            style={{
                                width: '100%', padding: '9px 12px', borderRadius: 8,
                                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer',
                            }}
                        >
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                        </select>
                    </div>
                    <div style={{ flex: 2 }}>
                        <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                            Model
                        </label>
                        <select
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            style={{
                                width: '100%', padding: '9px 12px', borderRadius: 8,
                                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer',
                            }}
                        >
                            {modelOptions.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* API Key */}
                <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                        <FontAwesomeIcon icon={faKey} style={{ marginRight: 6 }} />
                        API Key {isConfigured && <span style={{ color: 'rgba(255,255,255,0.3)' }}>— leave blank to keep existing</span>}
                    </label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder={isConfigured ? status.apiKeyMasked : (provider === 'anthropic' ? 'sk-ant-...' : 'sk-...')}
                            style={{
                                width: '100%', padding: '9px 40px 9px 12px', borderRadius: 8,
                                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff', fontSize: 13, outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                        <button
                            onClick={() => setShowKey(v => !v)}
                            style={{
                                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                                cursor: 'pointer', padding: 4, fontSize: 13,
                            }}
                        >
                            <FontAwesomeIcon icon={showKey ? faEyeSlash : faEye} />
                        </button>
                    </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                        onClick={handleSave}
                        disabled={saving || (!apiKey.trim() && !isConfigured)}
                        style={{
                            padding: '9px 20px', borderRadius: 8, border: 'none',
                            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                            color: '#fff', fontSize: 13, fontWeight: 500,
                            cursor: saving ? 'wait' : 'pointer',
                            opacity: (saving || (!apiKey.trim() && !isConfigured)) ? 0.5 : 1,
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
                                padding: '9px 16px', borderRadius: 8,
                                border: '1px solid rgba(255,255,255,0.15)',
                                background: 'rgba(255,255,255,0.05)',
                                color: '#fff', fontSize: 13, cursor: testing ? 'wait' : 'pointer',
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
                        padding: '10px 14px', borderRadius: 8, fontSize: 13,
                        background: testResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        border: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                        color: testResult.ok ? '#4ade80' : '#f87171',
                    }}>
                        {testResult.text}
                    </div>
                )}

                {/* Hint */}
                {!isConfigured && (
                    <div style={{
                        padding: '10px 14px', borderRadius: 8, fontSize: 12,
                        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)',
                        color: 'rgba(255,255,255,0.5)', lineHeight: 1.5,
                    }}>
                        Get your API key from{' '}
                        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer"
                            style={{ color: '#818cf8' }}>platform.openai.com</a>{' '}
                        (OpenAI) or{' '}
                        <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noreferrer"
                            style={{ color: '#818cf8' }}>console.anthropic.com</a>{' '}
                        (Anthropic). Keys are stored locally on your device.
                    </div>
                )}
            </div>
        </div>
    );
}

// =============================================================================

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
            padding: 16,
            background: isLoaded ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255,255,255,0.03)',
            borderRadius: 14,
            border: isLoaded ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255,255,255,0.06)',
            transition: 'all 0.2s'
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                {/* Icon */}
                <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: isLoaded
                        ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                        : model.downloaded
                            ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                            : 'rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 18, flexShrink: 0
                }}>
                    <FontAwesomeIcon icon={isLoaded ? faRocket : faMemory} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: '#fff', fontSize: 14 }}>
                            {model.name}
                        </span>
                        {isLoaded && (
                            <span style={{
                                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                                background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80'
                            }}>
                                ACTIVE
                            </span>
                        )}
                        <span style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 4,
                            background: `${getQualityColor(model.quality)}20`,
                            color: getQualityColor(model.quality)
                        }}>
                            {model.quality}
                        </span>
                    </div>

                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                        {model.description}
                    </div>

                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                        <span>Size: {model.size}</span>
                        <span>RAM: {model.ram}</span>
                        <span>Speed: {model.speed}</span>
                    </div>

                    {/* Download Progress */}
                    {isDownloading && (
                        <div style={{ marginTop: 10 }}>
                            <div style={{
                                height: 4, borderRadius: 2,
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
                            <div style={{ fontSize: 11, color: '#60a5fa', marginTop: 4 }}>
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
                                padding: '8px 14px',
                                borderRadius: 8,
                                border: 'none',
                                background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                                color: '#fff',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: isDownloading ? 'wait' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6,
                                opacity: isDownloading ? 0.7 : 1
                            }}
                        >
                            {isDownloading ? (
                                <FontAwesomeIcon icon={faCircleNotch} spin />
                            ) : (
                                <FontAwesomeIcon icon={faDownload} />
                            )}
                            {isDownloading ? 'Downloading...' : 'Download'}
                        </button>
                    ) : isLoaded ? (
                        <div style={{
                            padding: '8px 14px',
                            borderRadius: 8,
                            background: 'rgba(34, 197, 94, 0.15)',
                            color: '#4ade80',
                            fontSize: 12,
                            fontWeight: 500
                        }}>
                            In Use
                        </div>
                    ) : (
                        <button
                            onClick={onLoad}
                            disabled={isLoading}
                            style={{
                                padding: '8px 14px',
                                borderRadius: 8,
                                border: '1px solid rgba(255,255,255,0.15)',
                                background: 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: isLoading ? 'wait' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6
                            }}
                        >
                            {isLoading ? (
                                <>
                                    <FontAwesomeIcon icon={faCircleNotch} spin />
                                    Loading...
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
