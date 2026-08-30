// Keyboard grammar for /ai — a plain local-LLM chat, distinct from /agent's
// richer Claude Code panel. Always returns after handling (or ignoring) the
// key: /ai never falls through to the shared search-navigation logic.
export function handleAiChatKeydown(e, { query, sendAiMessage, setQuery, setCommandMode, setAiMessages }) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const prompt = query.replace(/^\/ai\s*/i, '').trim();
        if (prompt) {
            sendAiMessage(prompt);
            setQuery('/ai '); // Reset to just the command
        }
        return;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        setCommandMode(null);
        setAiMessages([]);
        setQuery('');
        return;
    }
    // Don't process other keys in AI mode
}
