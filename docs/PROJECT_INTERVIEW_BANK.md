# Project Interview — Slot & Question Bank per Persona

Design for the intent-driven "Create Project" flow: detect the user's persona from
categorized activity, then walk 5 universal slots with persona-specific wording and
chips drawn from the user's own engagement data. No slot is required; every question
is tap-to-answer (chips) with free-text fallback.

## Lazy-first interaction rules

Most users won't type. Every step of the interview is an MCQ, never a blank field:

1. **Every question ships with options** — 2–5 chips from real data, plus one
   `✏️ Something else…` chip that expands to a text input only when tapped. A blank
   input is never the first thing shown.
2. **Best guess is pre-selected.** The highest-engagement / highest-confidence chip
   per slot starts checked. The laziest valid path through the whole interview is
   tapping **Next → Next → Create** (or one **"Looks good — create it"** button that
   accepts all defaults at once).
3. **Multi-select everywhere.** Slots hold lists; radio buttons force fake choices.
4. **Skip is always visible** and skipping costs nothing — the curator agent fills
   skipped slots with `suggestedUrls` the user can prune later.
5. **Suggest the project itself (Step 0).** Don't open with "Name your project" —
   offer detected project candidates as cards (clustered from repo names, editor
   titles, own-domain activity, e.g. "CoolDesk launch", "k8s-ingress-gen"), each
   pre-filled with name + persona + slot guesses. Tapping a card skips straight to a
   pre-answered interview the user only confirms. `+ New project` (typed name) is the
   fallback, not the default.
6. **Cap the interview at ~4 visible questions.** Q0 (kind) + 3 highest-value slots
   for that persona; remaining slots appear as an optional "Add more" expander.

## The 5 universal slots

Every everyday-ready project workspace is the same 5 slots, whatever the persona:

| # | Slot | What it holds |
|---|------|---------------|
| 1 | **Anchor** | The thing itself — site, repo, store listing, doc, dashboard |
| 2 | **Create** | Where work gets made — editor + project folder, Figma, Canva, Docs |
| 3 | **Communicate** | Where the project is discussed — Slack, Gmail, Discord, communities |
| 4 | **Track** | Where work is planned — Notion, Jira, Trello, a spreadsheet |
| 5 | **Measure** | Where results are checked — GA, Search Console, Ads, Stripe, dashboards |

Only the wording and chip-ranking change per persona. Chips always come from the
user's real data (engagement-ranked domains filtered by category, open projects from
editor titles, running apps) — never from a generic list. If a slot has no detected
candidates, ask the question with a text/URL input; if the user skips, omit the slot.

## Persona detection

Run the user's top ~30 engagement-ranked domains through the category map
(`src/data/categories.js` / appstore.json) plus running-app signals. Score each
persona; if two score high, use the **blended** question set (union of their slots'
chip filters — wording from whichever persona ranks higher per slot).

| Persona | Signals (categories + apps) |
|---------|------------------------------|
| **Developer** | `developer` domains (github, stackoverflow, localhost, vercel, docs sites); editor/terminal running; `get_open_projects()` non-empty |
| **Marketer / Growth** | marketing/analytics domains (semrush, ads.google, meta business, mailchimp, search console, producthunt) |
| **Founder / Indie** | Developer AND Marketer both above threshold (this is the blended set, common enough to name) |
| **Creator / Designer** | design/creative domains (figma, canva, dribbble, behance); design apps running |
| **Analyst / Ops** | productivity+data domains (sheets, looker, notion databases, airtable, powerbi) |
| **Student / Researcher** | education domains (coursera, arxiv, university sites, notion, youtube-edu heavy) |
| **General** | No dominant signal → shortest, most jargon-free set |

Detection is a *prior*, not a gate: Q0 lets the user correct it.

## Q0 — always asked first (all personas)

> **"What kind of project is this?"**
> Chips: `Building an app` · `Marketing / launching` · `Design work` · `Research / learning` · `Analytics / reporting` · `Something else`
> Pre-selected: the detected persona. Multi-select allowed (Founder = first two).

This single tap fixes any misdetection and is understandable by everyone.

---

## Question bank

### Developer

| Slot | Question | Chip source |
|------|----------|-------------|
| Anchor | "What's the main repo or site for this project?" | `developer`-category domains w/ repo-like titles (github/gitlab), user's own domains |
| Create | "Which folder do you code this in?" | `get_open_projects()` editor titles; folder picker fallback |
| Communicate | "Where do you discuss this project?" | social/communication category: slack, discord, gmail, reddit |
| Track | "Where do you track issues or tasks?" | github issues URLs, jira, linear, notion from history |
| Measure | "Any dashboards you check for this? (deploys, errors, analytics)" | vercel, firebase, sentry, grafana, cloud consoles from history |

### Marketer / Growth

| Slot | Question | Chip source |
|------|----------|-------------|
| Anchor | "What are you promoting? (site, store page, product listing)" | user's own low-traffic-rank domains, store listings from history |
| Create | "Where do you make content for it?" | canva, figma, docs, video editors from history + running apps |
| Communicate | "Where do you talk to your audience or team?" | mail tools, social accounts, communities (reddit/producthunt/X) |
| Track | "Where do you plan campaigns or content?" | notion, trello, sheets, calendar from history |
| Measure | "Which numbers do you check? (ads, SEO, traffic)" | analytics/marketing category: GA, search console, ads managers, semrush, webmaster tools |

### Founder / Indie (blended — Developer + Marketer)

Asks Developer's Anchor/Create and Marketer's Measure; Communicate and Track merged:

1. "What's the main repo or site for this project?" (both chip pools)
2. "Which folder do you code this in?" (open projects)
3. "Where do you talk about it — team chat, communities, launch pages?" (slack/discord + reddit/producthunt/X)
4. "Where do you track tasks or campaigns?" (github issues + notion/trello/sheets)
5. "Which numbers do you check? (traffic, ads, deploys, revenue)" (GA/ads/semrush + vercel/firebase/stripe)

### Creator / Designer

1. "What's the main project or client this is for?" (behance/dribbble/portfolio/drive folders)
2. "Which tools do you create in?" (figma, canva, photoshop, blender — apps + domains)
3. "Where do you share work or get feedback?" (slack, mail, dribbble, instagram)
4. "Where do you keep briefs and to-dos?" (notion, docs, trello)
5. "Anywhere you track how your work performs?" (instagram insights, behance stats — skippable, weakest slot here)

### Analyst / Ops

1. "What's the main report, dashboard, or dataset?" (looker, powerbi, sheets w/ high engagement)
2. "Where do you build or edit it?" (sheets, excel, sql tools, notebooks)
3. "Who do you send it to / discuss it with?" (mail, slack, teams)
4. "Where are the requests or tickets tracked?" (jira, servicenow, notion)
5. "Which source systems feed it?" (crm, db consoles, ga — from history)

### Student / Researcher

1. "What are you studying or researching?" (free text + course/arxiv/university domains)
2. "Where do you take notes or write?" (notion, docs, obsidian, overleaf)
3. "Any groups or forums for it?" (discord, reddit, classroom)
4. "Where do you track deadlines or assignments?" (calendar, todo apps, LMS)
5. — omitted (Measure rarely applies; don't pad)

### General (no clear persona)

Three questions only, maximally plain:

1. "What's this project about?" (free text — feeds the curator's semantic matching)
2. "Which sites do you use for it?" (top engagement chips, uncategorized, multi-select)
3. "Which apps?" (running + installed app chips)

---

## Worked example — this user's live data (2026-07-10)

Detection over current tabs + history: **dev signals** (github.com `cooldesk-extension`,
vercel, firebase console, terminal, MS Store dev onboarding) AND **marketing signals**
(semrush, ads.google keyword planner, bing webmaster, producthunt ×4, indexnow)
→ **Founder / Indie** persona.

Interview for a project named "CoolDesk launch" would pre-fill:

1. **Anchor** → chips: `cool-desk.com` · `github.com/abhayraghuwanshi/cooldesk-extension` · `MS Store listing`
2. **Create folder** → chips from open editors/terminal: `extension` (File Explorer/terminal cwd)
3. **Communicate** → chips: `Product Hunt` · `Reddit (r/SideProject)` · `X`
4. **Track** → no candidates detected → plain input, skippable
5. **Measure** → chips: `Google Ads` · `Semrush` · `Bing Webmaster Tools` · `Firebase console` · `IndexNow`

Every chip above is a real URL/app from live data — the user assembles the workspace
in ~5 taps, and the curator agent fills `suggestedUrls` for gaps (e.g. Search Console
for cool-desk.com in Measure).

## Implementation notes

- **Interview endpoint** (`/llm/v3/interview`): does NOT need the LLM for chips —
  persona detection + slot chip-filtering is deterministic (category map + engagement
  score already in `llm_v3/tools.rs`). The LLM is optional garnish for question
  re-wording. Deterministic = instant UI, works without an API key.
- **Curate endpoint** (`/llm/v3/curate`): takes `{name, personas[], slotAnswers}` and
  runs the existing v3 tool loop to fill gaps + rank, returning the same JSON schema
  `useWorkspaceAgent.resolveAcceptedGroup()` already parses.
- Chip data sources already exist: `/activity` (engagement), `/tabs`, `search_apps`,
  `get_open_projects()`, category map in `src/data/categories.js`. The category
  matching should be ported to (or called from) the Rust side, or interview chips can
  be assembled fully in the frontend — frontend is simpler since categories.js lives
  there (O(1) Map lookup).
- Slot answers should be stored on the workspace (`slots: {anchor: [...], measure: [...]}`)
  so the post-creation learning loop can suggest per-slot ("found a new dashboard →
  Measure slot").

## Prerequisite: app/folder focus sampler (desktop activity parity)

Today only web URLs have engagement history; apps have live snapshots + spotlight
launch counts, folders/files have nothing. A Rust background task samples every ~30s
using three signals and writes daily rows `{app, window_title, date, active_s, media_s}`:

1. **Focus** — `GetForegroundWindow` (already implemented)
2. **Input recency** — `GetLastInputInfo`; no input within ~90s ⇒ user is idle
3. **Audio emission** — WASAPI session enumeration; which processes play sound

Attribution per sample (active and passive NEVER blend):

| State | Attribution |
|---|---|
| focused + recent input | focused app += **active** |
| visible + audible + not focused (YouTube on 2nd monitor) | that app += **passive media**; focused app still += active |
| focused + idle + audible (fullscreen movie) | app += **media**, not active |
| idle + silent | nothing (open ≠ used) |

Rules:
- **Interview/curator rank by `active` only.** Passive media never qualifies an app
  as "important to a project" (fixes e.g. Prime Video logging 103 idle hours in the
  current web activity data).
- **Browsers**: sampler records app-level browser time; per-URL attribution joins
  against extension activity instead of double-counting. Extension should adopt the
  same idle/audible split via `chrome.idle` + `tab.audible`.
- **Folders**: window-title parsing per sample (same as `get_open_projects()`) yields
  per-project dwell time for free.

### No-input activity cases

`GetLastInputInfo` counts every input device (keyboard, mouse, touch, pen) — but NOT
gamepads — and several legitimate activities produce no input at all:

| Case | Signal | Priority |
|---|---|---|
| Meeting/call (Zoom/Meet/Teams, silent + listening) | **mic/camera in use** — WASAPI *capture* session enumeration ⇒ active regardless of input | v1 |
| Reading / thinking (bursty input with gaps) | **decay window**, not hard cutoff: full active credit ≤ ~2 min idle, half to ~5, zero after; any input re-arms | v1 |
| Locked screen / lid closed | `WTSRegisterSessionNotification` lock/unlock ⇒ hard stop (also kills media-while-locked) | v1 (free) |
| Watching a build / long command in terminal | CPU usage of focused app's process tree ⇒ weak credit | v2 |
| Muted media on 2nd monitor | extension media-playing state per tab (WASAPI can't see it); desktop players: ignore | v2 |
| Gaming with controller | XInput polling when a game is focused | v2 |
| Side-by-side work (code + docs, 2 monitors) | 30s focus sampling averages out; ALSO log **co-visibility pairs** (windows repeatedly visible together) — strong workspace-grouping signal for the curator | log from v1 |

## Optional layer: screenshot journal (auto-documentation)

Recall/Rewind-style visual journal on top of the sampler. Opt-in, local-only.

**Capture**: focused-window-only shots (Windows.Graphics.Capture or `xcap` crate),
downscaled ~1280px → WebP q60 (50–150 KB/frame).

**Triggers — event-driven, not random**:
1. Context switch (focus → different app/project), after ~5s settle
2. Heartbeat every 3–5 min ONLY while sampler says active; never when idle/locked
3. Dedup via perceptual hash (dHash) — skip near-identical frames per app
   (a movie = 1 frame, not 40)

~100–200 frames/day ≈ 10–25 MB. Retention: full-res 14d → thumbnail → delete 90d.

**Hard exclusions**: banking/finance/health domains via the category DB, password
managers, incognito windows (extension flag), lock/UAC screens, title-pattern
matches. Tray pause state + "delete today" button. Off by default.

**Consumers**:
- `DailyMemory.summary` — frames + sampler rows auto-generate the "your day" page
- OCR each kept frame (`Windows.Media.Ocr`, built into Windows) → index text →
  spotlight answers "that error I saw yesterday" (Rewind-style search)
- Curator evidence: frames attached to activity rows make suggestions explainable
