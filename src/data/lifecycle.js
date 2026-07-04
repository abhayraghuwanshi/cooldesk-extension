// Work-lifecycle taxonomy — an ORTHOGONAL layer to the topic categories in
// categories.js / appstore.json. Those answer "what kind of site is this?"
// (finance, social, shopping…). This answers "which phase of building is this?"
// so we can track a workspace's lifecycle: Design → Build → AI & Data → Ship →
// Grow → Create.
//
// Design goals:
//   - Deterministic: the same URL always maps to the same stage, so phase charts
//     are stable over time (no AI jitter). AI is only a fallback for the unknown
//     tail (see classifyLifecycleWithAI) and its result is cached back here.
//   - Single primary stage per URL → breakdown percentages sum to 100%.
//   - Cheap: O(host-depth) Map lookups, safe to run on every workspace render.

// ── Stages (ordered: this is the canonical lifecycle order for display) ────────
export const STAGES = ['design', 'build', 'ai-data', 'ship', 'grow', 'create'];

export const STAGE_META = {
  'design':  { label: 'Design',      color: '#c084fc', hint: 'Mockups, UI, assets, inspiration' },
  'build':   { label: 'Build',       color: '#60a5fa', hint: 'Code, repos, docs, packages, APIs' },
  'ai-data': { label: 'AI & Data',   color: '#34d399', hint: 'LLMs, ML, notebooks, analytics, BI' },
  'ship':    { label: 'Ship',        color: '#fbbf24', hint: 'Hosting, deploy, infra, monitoring, stores' },
  'grow':    { label: 'Grow',        color: '#fb7185', hint: 'Analytics, SEO, marketing, payments, CRM' },
  'create':  { label: 'Create',      color: '#f97316', hint: 'Writing, docs, content, video, CMS' },
};

// ── Domain dictionary ──────────────────────────────────────────────────────────
// Each domain belongs to exactly ONE stage (no overlap → deterministic single
// assignment). For tools that genuinely span phases we pick the primary use
// (e.g. Canva → create, Figma → design). Suffix-matched: "x.figma.com" → design.
// This is a curated starting set — extend freely; ordering here does not matter.
const STAGE_DOMAINS = {
  'design': [
    'figma.com', 'sketch.com', 'framer.com', 'dribbble.com', 'behance.net',
    'penpot.app', 'excalidraw.com', 'tldraw.com', 'miro.com', 'whimsical.com',
    'zeplin.io', 'invisionapp.com', 'marvelapp.com', 'spline.design', 'rive.app',
    'lottiefiles.com', 'coolors.co', 'realtimecolors.com', 'fonts.google.com',
    'fontshare.com', 'fontawesome.com', 'iconify.design', 'heroicons.com',
    'unsplash.com', 'pexels.com', 'mobbin.com', 'land-book.com', 'godly.website',
    'uiverse.io', 'lapa.ninja',
  ],
  'build': [
    'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com',
    'stackexchange.com', 'developer.mozilla.org', 'npmjs.com', 'pypi.org',
    'crates.io', 'docs.rs', 'pkg.go.dev', 'packagist.org', 'codesandbox.io',
    'codepen.io', 'replit.com', 'stackblitz.com', 'glitch.com', 'jsfiddle.net',
    'regex101.com', 'devdocs.io', 'caniuse.com', 'postman.com', 'hoppscotch.io',
    'insomnia.rest', 'sourcegraph.com', 'linear.app', 'shortcut.com',
    'readthedocs.io', 'web.dev', 'css-tricks.com', 'tailwindcss.com', 'react.dev',
    'vuejs.org', 'svelte.dev', 'nextjs.org', 'nodejs.org', 'rust-lang.org',
    'go.dev', 'python.org', 'typescriptlang.org',
  ],
  'ai-data': [
    'chatgpt.com', 'openai.com', 'claude.ai', 'anthropic.com', 'gemini.google.com',
    'aistudio.google.com', 'perplexity.ai', 'huggingface.co', 'kaggle.com',
    'midjourney.com', 'civitai.com', 'replicate.com', 'together.ai', 'groq.com',
    'ollama.com', 'langchain.com', 'llamaindex.ai', 'pinecone.io', 'weaviate.io',
    'wandb.ai', 'databricks.com', 'snowflake.com', 'getdbt.com', 'airbyte.com',
    'jupyter.org', 'deepnote.com', 'hex.tech', 'observablehq.com', 'metabase.com',
    'looker.com', 'tableau.com',
  ],
  'ship': [
    'vercel.com', 'netlify.com', 'render.com', 'railway.app', 'fly.io', 'heroku.com',
    'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com', 'digitalocean.com',
    'cloudflare.com', 'supabase.com', 'firebase.google.com', 'planetscale.com',
    'neon.tech', 'mongodb.com', 'docker.com', 'kubernetes.io', 'sentry.io',
    'datadoghq.com', 'newrelic.com', 'circleci.com', 'ngrok.com', 'namecheap.com',
    'godaddy.com', 'uptimerobot.com', 'statuspage.io', 'appstoreconnect.apple.com',
  ],
  'grow': [
    'analytics.google.com', 'tagmanager.google.com', 'ads.google.com', 'ahrefs.com',
    'semrush.com', 'moz.com', 'similarweb.com', 'mailchimp.com', 'hubspot.com',
    'sendgrid.com', 'customer.io', 'posthog.com', 'mixpanel.com', 'amplitude.com',
    'hotjar.com', 'intercom.com', 'producthunt.com', 'indiehackers.com', 'buffer.com',
    'hootsuite.com', 'later.com', 'typeform.com', 'calendly.com', 'stripe.com',
    'paddle.com', 'lemonsqueezy.com', 'gumroad.com',
  ],
  'create': [
    'notion.so', 'medium.com', 'ghost.org', 'wordpress.com', 'webflow.com',
    'contentful.com', 'sanity.io', 'strapi.io', 'capcut.com', 'descript.com',
    'canva.com', 'obsidian.md', 'roamresearch.com', 'coda.io', 'loom.com',
    'riverside.fm', 'grammarly.com', 'hemingwayapp.com', 'quillbot.com',
    'substack.com', 'beautiful.ai',
  ],
};

// ── Pattern rules (checked only when no exact domain match) ─────────────────────
// Catch host/path shapes that span many domains. Ordered by priority.
const STAGE_PATTERNS = [
  { stage: 'ship',    re: /console\.(aws|cloud\.google|firebase)|\.azure\.|search\.google\.com\/search-console|play\.google\.com\/console/i },
  { stage: 'build',   re: /(^|\.)docs\.|\/docs\/|api\.|\.dev$|developer\.|localhost|127\.0\.0\.1|raw\.githubusercontent|gist\.github/i },
  { stage: 'ai-data', re: /\bai\b|\bml\b|llm|gpt|colab\.research|notebook/i },
  { stage: 'create',  re: /docs\.google\.com\/document|studio\.youtube|youtube\.com\/studio/i },
  { stage: 'grow',    re: /analytics|\/ads\b|marketing|newsletter/i },
];

// ── Build O(1) lookup once ──────────────────────────────────────────────────────
const DOMAIN_TO_STAGE = new Map();
for (const stage of STAGES) {
  for (const domain of STAGE_DOMAINS[stage] || []) {
    DOMAIN_TO_STAGE.set(domain.toLowerCase(), stage);
  }
}

// Runtime overrides — AI fallback results get cached here so a domain is only
// classified by AI once (keeps everything deterministic afterwards).
const RUNTIME_OVERRIDES = new Map();

function hostnameOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
}

/**
 * Classify a single URL into a lifecycle stage.
 * @returns {string} one of STAGES, or 'unknown' if not recognised.
 */
export function classifyLifecycle(url) {
  const host = hostnameOf(url);
  if (!host) return 'unknown';

  if (RUNTIME_OVERRIDES.has(host)) return RUNTIME_OVERRIDES.get(host);

  // Exact + progressively-shorter suffix match: a.b.figma.com → figma.com.
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const hit = DOMAIN_TO_STAGE.get(candidate);
    if (hit) return hit;
  }

  // Pattern fallback (matches against the full URL so paths count).
  const full = String(url).toLowerCase();
  for (const { stage, re } of STAGE_PATTERNS) {
    if (re.test(full)) return stage;
  }

  return 'unknown';
}

/** Manually pin a domain → stage (e.g. after an AI fallback decision). */
export function setLifecycleOverride(domainOrUrl, stage) {
  if (!STAGES.includes(stage)) return;
  RUNTIME_OVERRIDES.set(hostnameOf(domainOrUrl), stage);
}

/**
 * Lifecycle breakdown for one workspace's URLs.
 * @param {{urls?: Array<{url:string,title?:string}>}} workspace
 * @returns {{
 *   stages: Record<string,{urls:Array,count:number,pct:number}>,
 *   dominant: string|null,   // stage with the most URLs (excludes 'unknown')
 *   coverage: number,        // fraction of URLs we could classify (0..1)
 *   classified: number,
 *   total: number,
 *   unknown: Array
 * }}
 */
export function getWorkspaceLifecycle(workspace) {
  const urls = (workspace?.urls || []).filter(u => u && u.url);
  const stages = {};
  for (const s of STAGES) stages[s] = { urls: [], count: 0, pct: 0 };
  const unknown = [];

  for (const entry of urls) {
    const stage = classifyLifecycle(entry.url);
    if (stage === 'unknown') { unknown.push(entry); continue; }
    stages[stage].urls.push(entry);
    stages[stage].count += 1;
  }

  const classified = urls.length - unknown.length;
  for (const s of STAGES) {
    stages[s].pct = classified ? Math.round((stages[s].count / classified) * 100) : 0;
  }

  let dominant = null;
  let max = 0;
  for (const s of STAGES) {
    if (stages[s].count > max) { max = stages[s].count; dominant = s; }
  }

  return {
    stages,
    dominant,
    coverage: urls.length ? classified / urls.length : 0,
    classified,
    total: urls.length,
    unknown,
  };
}

/**
 * AI fallback for the unknown tail. Pass a chat function (the same resolveChatFn
 * the workspace agent uses). Classifies only the domains the dictionary missed,
 * caches each result via setLifecycleOverride so it never re-asks.
 * @param {Array<{url:string,title?:string}>} unknownUrls
 * @param {(prompt:string)=>Promise<{ok:boolean,response?:string}>} chatFn
 * @returns {Promise<Record<string,string>>} host → stage decisions
 */
export async function classifyLifecycleWithAI(unknownUrls, chatFn) {
  const hosts = [...new Set(unknownUrls.map(u => hostnameOf(u.url)).filter(Boolean))];
  if (!hosts.length || typeof chatFn !== 'function') return {};

  const prompt = `Classify each website into ONE software-product lifecycle stage.
Stages: ${STAGES.map(s => `${s} (${STAGE_META[s].hint})`).join('; ')}.

Sites:
${hosts.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Return JSON only: {"map":{"host.com":"build", ...}} using exactly the stage keys above.`;

  try {
    const result = await chatFn(prompt);
    const match = result?.response?.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const parsed = JSON.parse(match[0]);
    const out = {};
    for (const [host, stage] of Object.entries(parsed.map || {})) {
      if (STAGES.includes(stage)) {
        setLifecycleOverride(host, stage);
        out[host] = stage;
      }
    }
    return out;
  } catch {
    return {};
  }
}
