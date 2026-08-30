import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// The /ai chat transcript — plain local-LLM Q&A, distinct from /agent's
// richer Claude Code panel (which has its own file's worth of state).
export function AiChatPanel({ isAiLoading, aiMessages }) {
    return (
        <div className="spotlight-ai-mode">
            <div className="spotlight-ai-header">
                <FontAwesomeIcon icon={faRobot} style={{ color: '#A78BFA' }} />
                <span>AI Chat</span>
                {isAiLoading && (
                    <div style={{ width: 14, height: 14, border: '2px solid rgba(139, 92, 246, 0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />
                )}
            </div>
            <div className="spotlight-ai-messages">
                {aiMessages.length === 0 && (
                    <div className="spotlight-ai-hint">
                        Type your message and press Enter to chat with AI
                    </div>
                )}
                {aiMessages.map((msg, idx) => (
                    <div key={idx} className={`spotlight-ai-message ${msg.role}`}>
                        <div className="message-avatar">
                            {msg.role === 'user' ? '👤' : msg.role === 'error' ? '⚠️' : '🤖'}
                        </div>
                        <div className="message-content">{msg.content}</div>
                    </div>
                ))}
                {isAiLoading && (
                    <div className="spotlight-ai-message assistant loading">
                        <div className="message-avatar">🤖</div>
                        <div className="message-content">
                            <span className="typing-indicator">
                                <span></span><span></span><span></span>
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
