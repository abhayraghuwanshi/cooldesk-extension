import { faPaperPlane, faRocket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';

/**
 * Quick LLM Test Panel
 * Simple UI to test the local LLM functionality
 */
export default function LLMTestPanel() {
    const [prompt, setPrompt] = useState('');
    const [response, setResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const isElectron = typeof window !== 'undefined' && window.electronAPI?.llm;

    const handleTest = async () => {
        if (!prompt.trim()) return;

        setLoading(true);
        setError('');
        setResponse('');

        try {
            const result = await window.electronAPI.llm.chat(prompt);
            setResponse(result);
        } catch (err) {
            setError(err.message || 'Failed to get response');
        } finally {
            setLoading(false);
        }
    };

    const runQuickTests = async () => {
        setLoading(true);
        setError('');
        const results = [];

        try {
            // Test 1: Simple chat
            results.push('=== Test 1: Simple Chat ===');
            const chat = await window.electronAPI.llm.chat("Say hello in one sentence!");
            results.push(`Response: ${chat}\n`);

            // Test 2: Summarization
            results.push('=== Test 2: Summarization ===');
            const summary = await window.electronAPI.llm.summarize(
                "Artificial intelligence is transforming the world. Machine learning models can now understand text, generate images, and even write code. The future of AI is incredibly exciting.",
                1
            );
            results.push(`Summary: ${summary}\n`);

            // Test 3: Categorization
            results.push('=== Test 3: Categorization ===');
            const category = await window.electronAPI.llm.categorize(
                "GitHub - Where the world builds software",
                "https://github.com",
                ["Technology", "Social Media", "News", "Shopping"]
            );
            results.push(`Category: ${category}\n`);

            setResponse(results.join('\n'));
        } catch (err) {
            setError(err.message || 'Tests failed');
        } finally {
            setLoading(false);
        }
    };

    if (!isElectron) {
        return (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                <p>LLM testing only available in Electron app</p>
            </div>
        );
    }

    return (
        <div style={{
            padding: 24,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.06)',
            maxWidth: 800,
            margin: '20px auto'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff'
                }}>
                    <FontAwesomeIcon icon={faRocket} />
                </div>
                <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#fff' }}>
                        LLM Test Panel
                    </h3>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                        Test your local AI model
                    </div>
                </div>
            </div>

            {/* Quick Tests Button */}
            <button
                onClick={runQuickTests}
                disabled={loading}
                style={{
                    width: '100%',
                    padding: 12,
                    marginBottom: 16,
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: loading ? 'wait' : 'pointer',
                    opacity: loading ? 0.7 : 1
                }}
            >
                {loading ? 'Running Tests...' : '🚀 Run Quick Tests'}
            </button>

            {/* Custom Prompt */}
            <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#fff', fontWeight: 500 }}>
                    Custom Prompt:
                </label>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter your prompt here..."
                    disabled={loading}
                    style={{
                        width: '100%',
                        minHeight: 80,
                        padding: 12,
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)',
                        color: '#fff',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        resize: 'vertical'
                    }}
                />
            </div>

            <button
                onClick={handleTest}
                disabled={loading || !prompt.trim()}
                style={{
                    width: '100%',
                    padding: 12,
                    marginBottom: 16,
                    borderRadius: 10,
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: '#60a5fa',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: (loading || !prompt.trim()) ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: (loading || !prompt.trim()) ? 0.5 : 1
                }}
            >
                <FontAwesomeIcon icon={faPaperPlane} />
                {loading ? 'Generating...' : 'Send Prompt'}
            </button>

            {/* Error Display */}
            {error && (
                <div style={{
                    padding: 12,
                    marginBottom: 16,
                    borderRadius: 10,
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    fontSize: 13
                }}>
                    {error}
                </div>
            )}

            {/* Response Display */}
            {response && (
                <div>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#fff', fontWeight: 500 }}>
                        Response:
                    </label>
                    <div style={{
                        padding: 16,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontSize: 13,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace'
                    }}>
                        {response}
                    </div>
                </div>
            )}
        </div>
    );
}
