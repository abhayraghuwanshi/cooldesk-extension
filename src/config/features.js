// Build-time feature flags.

// Team / P2P shared spaces (TeamView face, Settings "Team" tab, /team commands).
// Hidden until CoolDesk has multi-user demand — flip to true to bring it all back.
export const TEAM_FEATURE_ENABLED = false;

// Where the "install the browser extension" button in onboarding points.
// TODO: swap for the direct Chrome Web Store listing once it is published —
// the repo has no store ID yet, so this falls back to the marketing site.
export const EXTENSION_INSTALL_URL = 'https://cool-desk.com';

// Voice search — the mic button in the spotlight search box and the
// speech-recognition hook behind it. Off until voice is worth shipping;
// flip to true to bring the mic back.
export const VOICE_SEARCH_ENABLED = false;
