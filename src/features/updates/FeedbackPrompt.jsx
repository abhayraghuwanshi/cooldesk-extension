import React, { useEffect, useState } from 'react';
import './UpdateBanner.css';
import {
  dismissFeedback,
  shouldAskForFeedback,
  submitFeedback,
} from '../../services/analytics';
import { pingSoon } from '../../services/updateService';

const ISSUES_URL = 'https://github.com/abhayraghuwanshi/cooldesk-extension/issues/new';

const CHOICES = [
  { rating: 'great', label: 'Love it' },
  { rating: 'okay', label: "It's okay" },
  { rating: 'not_for_me', label: 'Not for me' },
];

async function openExternal(url) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_url', { url });
  } catch {
    window.open(url, '_blank', 'noreferrer');
  }
}

/**
 * One-time "how's it going?" strip, shown after FEEDBACK_AFTER_DAYS days on
 * which the user actually used CoolDesk (desktop only, and only while usage
 * analytics are on, since the answer travels with the anonymous ping). Three
 * fixed answers, no free text; answering or dismissing hides it for good.
 */
export function FeedbackPrompt() {
  const [phase, setPhase] = useState('hidden'); // hidden | ask | thanks
  const [rating, setRating] = useState(null);

  useEffect(() => {
    if (shouldAskForFeedback()) setPhase('ask');
  }, []);

  if (phase === 'hidden') return null;

  if (phase === 'thanks') {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner__text">Thanks — that helps.</span>
        <div className="update-banner__actions">
          {rating !== 'great' && (
            <a
              className="update-banner__link"
              href={ISSUES_URL}
              onClick={(e) => { e.preventDefault(); openExternal(ISSUES_URL); }}
            >
              Tell us what's missing
            </a>
          )}
          <button className="update-banner__btn" onClick={() => setPhase('hidden')}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">How's CoolDesk working for you?</span>
      <div className="update-banner__actions">
        {CHOICES.map((c) => (
          <button
            key={c.rating}
            className="update-banner__btn"
            onClick={() => {
              submitFeedback(c.rating);
              setRating(c.rating);
              setPhase('thanks');
              pingSoon();
            }}
          >
            {c.label}
          </button>
        ))}
        <button
          className="update-banner__btn"
          aria-label="Dismiss"
          onClick={() => { dismissFeedback(); setPhase('hidden'); }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

export default FeedbackPrompt;
