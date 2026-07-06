# CoolDesk Demo Video — "Your day, as a team, with CoolDesk"

Goal: 90–120 second screen-capture demo for YouTube / X / LinkedIn.
Story: a developer's normal day on a team — standup, feature work, a review
request, context switching — and CoolDesk keeping all of it together.
CTA: star the GitHub repo + leave feedback.

> Positioning note: CoolDesk is local-first and single-user. The "team" angle
> is *you working on a team*, with CoolDesk as the teammate that never forgets
> context. Don't imply shared/multi-user workspaces.

---

## Format

- **Length:** 100 sec main cut. A 55-sec cut for X is marked with ✂️ (keep only ✂️ scenes).
- **Style:** real screen recording, fast pacing, cursor visible, keystrokes shown
  on screen (use a keystroke overlay like Keyviz/KeyCastr).
- **Audio:** voiceover + subtle lo-fi bed. Every line is short enough to breathe.
- **Prep before recording:** clean desktop, 8–10 realistic tabs open (GitHub PR,
  Jira/Linear ticket, docs, Figma, localhost:5173), 2–3 workspaces pre-made
  ("Payments API", "Frontend Revamp", "Interview Prep"), a dev server running,
  notes/todos already in one workspace so panels don't look empty.

---

## Script

### Scene 1 — The hook (0:00–0:08) ✂️

**Screen:** Messy reality: a taskbar full of windows, a browser with 30 tabs,
Slack blinking. Quick cuts, 1s each.

**VO:**
> "You're on a team. Which means your day is standup, three projects,
> someone's PR, and forty tabs you're afraid to close."

**On-screen text:** `sound familiar?`

---

### Scene 2 — One keystroke (0:08–0:20) ✂️

**Screen:** Press **Alt+K** → CoolDesk spotlight appears over everything.
Type `fig` → Figma (running app) is top result → Enter → Figma focuses instantly.
Alt+K again, type `payments` → the ticket tab surfaces → Enter.

**VO:**
> "This is CoolDesk. One keystroke — Alt+K — and everything you have open is
> searchable. Apps, browser tabs, even terminal tabs. No more alt-tab roulette."

**On-screen text:** `Alt+K → anything`

---

### Scene 3 — Standup in 10 seconds (0:20–0:35) ✂️

**Screen:** Open the "Payments API" workspace. The context panel shows
yesterday's notes, todos, and status. Scroll it briefly.

**VO:**
> "9:30, standup. Instead of reconstructing yesterday from memory, my workspace
> already has it: the notes I captured, the todos, where I left off.
> I just read it out."

**On-screen text:** `standup prep: 0 minutes`

---

### Scene 4 — Context switch without the tax (0:35–0:50) ✂️

**Screen:** In spotlight, press **←/→** to flip between workspaces
("Payments API" → "Frontend Revamp"). Tabs/apps for that project are right
there. Open one with Enter.

**VO:**
> "A teammate pings me — the frontend thing is blocking them. Normally that
> context switch costs twenty minutes. Here, workspaces are one arrow key
> apart. Everything for that project, grouped: tabs, notes, todos."

---

### Scene 5 — Capture while you review (0:50–1:05)

**Screen:** On the teammate's PR / a docs page, select a paragraph → save it to
daily notes via the extension. Then show it landed in the workspace notes.

**VO:**
> "While reviewing their PR I highlight anything worth keeping — it goes
> straight into my daily notes. When they ask 'why did we decide that?' two
> weeks from now… I actually have the answer."

---

### Scene 6 — The dev server graveyard (1:05–1:20)

**Screen:** Scroll to the **Dev Servers** panel: node.exe :5173, orphaned
processes with CPU/RAM. Hover a card → click **Kill** → confirm → gone.
Click **Open** on another → browser jumps to the tab.

**VO:**
> "And every dev's favorite mystery: 'port already in use.' CoolDesk shows
> every local server that's running — including the orphaned ones — and kills
> them in one click."

**On-screen text:** `RIP node.exe :5173`

---

### Scene 7 — It learns you (1:20–1:30)

**Screen:** Type a short query in spotlight (`jra`) → your team's Jira board is
the top hit. Caption explains it learned from your clicks.

**VO:**
> "The more you use it, the better it ranks. It learns which results *you*
> actually pick."

---

### Scene 8 — CTA (1:30–1:45) ✂️

**Screen:** CoolDesk logo + GitHub repo page. Cursor hovers the ⭐ Star button
and clicks it. Show install commands as text.

**VO:**
> "CoolDesk is open source, local-first — your data never leaves your machine.
> It's free: winget or Homebrew, link below. If it looks useful, star the repo,
> and tell me what's missing — I'm building this in the open."

**On-screen text:**
```
⭐ github.com/abhayraghuwanshi/cooldesk-extension
winget install CoolDesk.CoolDesk   |   brew install --cask cooldesk
```

---

## ✂️ 55-second cut (X / LinkedIn native video)

Scenes 1 → 2 → 3 → 4 → 8, tightened VO. Hook stays identical; skip capture,
dev servers, and learning-rank scenes (tease them: "and it does a lot more —
full demo on YouTube").

---

## Platform captions

### YouTube

**Title options (pick one):**
1. `I built an open-source app that remembers your work context — CoolDesk demo`
2. `Standup prep in 0 minutes: how I manage team chaos with one keystroke`
3. `CoolDesk: spotlight search + workspaces for Windows/macOS (open source)`

**Description:**
```
CoolDesk turns scattered tabs, apps and notes into organized project workspaces —
with a spotlight search (Alt+K) across everything you have open. Local-first,
open source, built with Tauri + React.

In this demo: working a normal team day — standup, context switching between
projects, PR review notes, and killing orphaned dev servers.

⭐ Star the repo: https://github.com/abhayraghuwanshi/cooldesk-extension
🧩 Chrome extension: https://chromewebstore.google.com/detail/new-tab-by-cooldesk/ioggffobciopdddacpclplkeodllhjko

Install:
  Windows:  winget install CoolDesk.CoolDesk
  macOS:    brew tap abhayraghuwanshi/cooldesk https://github.com/abhayraghuwanshi/cooldesk-extension
            brew install --cask cooldesk

I'm building this in the open — feedback, issues and feature requests are very
welcome. What's the one thing that would make you use it daily?

00:00 The 40-tab problem
00:08 Alt+K — search everything you have open
00:20 Standup prep in 10 seconds
00:35 Context switching between projects
00:50 Capture notes while reviewing a PR
01:05 Kill orphaned dev servers
01:20 Ranking that learns from you
01:30 Open source — star & feedback
```

**Tags:** productivity, developer tools, open source, tauri, react, spotlight
search, tab management, window manager, workflow

### X.com

Post the 55-sec video natively (don't link YouTube in the first post — the
algorithm buries external links; reply with the link instead).

**Post:**
```
Your day on a dev team: standup, 3 projects, someone's PR, 40 tabs.

I built CoolDesk — one keystroke (Alt+K) searches every app, tab and terminal
you have open. Workspaces remember your context per project. Local-first,
open source.

Would love feedback 👇
```

**Reply 1:** `⭐ Repo: https://github.com/abhayraghuwanshi/cooldesk-extension — a star genuinely helps. Windows: winget install CoolDesk.CoolDesk · macOS: brew install --cask cooldesk`

**Reply 2:** `Bonus: it lists every local dev server (including orphaned node processes) and kills them in one click. "Port already in use" is dead.` (attach the dev-servers clip as a standalone GIF)

### LinkedIn

Native video + longer text. LinkedIn rewards a story, not a feature list.

```
Every context switch on a team costs ~20 minutes of "where was I?"

Standup asks what you did yesterday. A teammate needs you on a different
project. A PR review interrupts your feature work. By 3pm you have 40 tabs
open because closing any of them feels like losing state.

I got tired of it, so I built CoolDesk — an open-source desktop app that keeps
your work context for you:

→ Alt+K spotlight: search every open app, browser tab, and terminal tab
→ Workspaces: tabs + notes + todos + status, grouped per project
→ Capture: highlight anything while reading, it lands in your daily notes
→ Dev servers: see and kill orphaned localhost processes in one click

It's local-first (nothing leaves your machine), free, and built with Tauri +
React. Windows and macOS.

Demo below (100 seconds). If this looks useful, a GitHub star helps more than
you'd think — and I'd genuinely love to hear what would make it fit YOUR
workflow. Building this in the open.

⭐ github.com/abhayraghuwanshi/cooldesk-extension

#opensource #productivity #developertools #buildinpublic
```

---

## Recording checklist

- [ ] Fresh recording profile: hide personal bookmarks, email, notifications
- [ ] Seed realistic data: 3 workspaces with notes/todos, 8–10 tabs, 1–2 dev servers running
- [ ] Keystroke overlay on (Alt+K must be *visible* every time)
- [ ] 1080p minimum, 60fps if possible; record at 125% zoom so text is readable on phones
- [ ] Record each scene separately — retakes are cheap, re-recording everything isn't
- [ ] Captions/subtitles burned in for the X/LinkedIn cut (most watch muted)
- [ ] End frame holds the repo URL for a full 3 seconds
