import { useState } from 'react';
import { sendMessage } from '../services/extensionApi';

export function useAISuggestions() {
  const [aiState, setAiState] = useState({ loading: false, suggestions: [], error: null })

  const getSuggestions = async (urls) => {
    try {
      setAiState({ loading: true, suggestions: [], error: null });
      const response = await sendMessage({ action: 'getSuggestionFor', urls: Array.isArray(urls) ? urls : [urls] });

      if (!response?.ok) {
        setAiState({ loading: false, suggestions: [], error: response?.error || 'AI error' });
        return;
      }

      // The response from the background script may be a JSON string or already parsed.
      let suggestions = [];
      try {
        if (Array.isArray(response.suggestions)) {
          suggestions = response.suggestions;
        } else if (typeof response.suggestions === 'string') {
          const parsed = JSON.parse(response.suggestions);
          if (parsed && Array.isArray(parsed.suggestions)) {
            suggestions = parsed.suggestions;
          }
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
