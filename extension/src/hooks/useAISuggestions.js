import { useState } from 'react';

export function useAISuggestions() {
  const [aiState, setAiState] = useState({ loading: false, suggestions: [], error: null })

  const getSuggestions = async (urls) => {
    try {
      setAiState({ loading: true, suggestions: [], error: null });
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSuggestionFor', urls: Array.isArray(urls) ? urls : [urls] }, resolve);
      });

      if (!response?.ok) {
        setAiState({ loading: false, suggestions: [], error: response?.error || 'AI error' });
        return;
      }

      // The response from the background script is a string, so we need to parse it.
      let suggestions = [];
      try {
        const parsed = JSON.parse(response.suggestions);
        if (parsed && Array.isArray(parsed.suggestions)) {
          suggestions = parsed.suggestions;
        }
      } catch (e) {
        console.error('Failed to parse AI suggestions:', e);
        setAiState({ loading: false, suggestions: [], error: 'Failed to parse AI response.' });
        return;
      }

      setAiState({
        loading: false,
        suggestions: suggestions,
        error: null,
      });
    } catch (err) {
      setAiState({ loading: false, suggestions: [], error: String(err) })
    }
  }

  return { ...aiState, getSuggestions }
}
