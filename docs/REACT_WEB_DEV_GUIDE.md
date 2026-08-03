# Build the CoolDesk Frontend in React
### 15 tasks. You open a toy shop, and accidentally learn React.

Companion to [`RUST_WEB_DEV_GUIDE.md`](./RUST_WEB_DEV_GUIDE.md) — that one
teaches `src-tauri/`, this one teaches `src/`.

---

## Read this bit first

This is **not** a tour of React features. It's a build. You start with an empty
file and finish with a working version of CoolDesk's spotlight launcher and
app shell. Every React concept shows up at the moment you actually need it —
which is the only time it makes sense.

Every task has the same shape:

> 🏪 **The shop** — where you are in the story
> 🎯 **The task** — what you're building
> 🔨 **Build it** — code you type
> 🧸 / 🧒 — the new idea, explained twice
> 📂 **In the real codebase** — the grown-up version, with `file:line`
> ⚠️ **The trap** — what breaks here, and why it's usually invisible
> ✅ **Checkpoint** — what should work before you move on

**Prerequisites:** JavaScript (closures, `async`/`await`, spread syntax, array
methods). No React needed. No TypeScript in this repo, so none here.

**Setup:** you can type the code into any Vite + React scratch project
(`npm create vite@latest -- --template react`), or just read it next to
`src/` with the file references open. Both work. Typing is better.

---

## The story

Everything in this tutorial is explained twice: once for a five-year-old, once
for a ten-year-old. They both use **one story**, so the ideas stack instead of
being fifteen unrelated metaphors.

**You have just been handed the keys to a toy shop.** It has a big display
window onto the street. Your job over the next fifteen tasks is to get that
window working — and then working *well*.

You also have a helper: **Robo, the window-dresser**.

| In the story | In React | Turns up in |
|---|---|---|
| **You**, the shopkeeper | the programmer | all of it |
| **Robo**, the window-dresser | React itself | Task 1 |
| The **window** onto the street | the DOM / the screen | Task 1 |
| Your **notebook** | state | Task 2 |
| A **note pinned to a toy** | props | Task 1 |
| **Name tags** on the toys | `key` | Task 3 |
| **Helpers** (Sam, Ravi, Mia) | child components | Task 1 |
| A **sticky note in your pocket** | a ref | Task 6 |
| **Fairy lights, doorbell, storeroom phone** | effects | Task 4 |
| The **storeroom** — slow, messy | async data / the backend | Task 4 |
| **Ticket numbers** on orders | request IDs | Task 6 |
| A **poster on the wall** | context | Task 11 |
| **Numbered drawers** behind the counter | the hooks array | Task 9 |
| A **"shelf being fixed" card** | an error boundary | Task 14 |

And the one rule the entire framework is built on:

> **You never touch the window. You write in the notebook. Robo fixes the
> window.**

---

## The build, at a glance

| | Task | You build | You learn |
|---|---|---|---|
| **Part 1** | 0 | Mount the app | `createRoot`, `StrictMode` |
| *Open the shop* | 1 | One result row | components, JSX, props |
| | 2 | The search input | `useState`, controlled inputs |
| | 3 | The results list | lists, `key`, reconciliation |
| **Part 2** | 4 | Real search results | `useEffect`, cleanup, async |
| *Call the storeroom* | 5 | Debounced typing | cleanup as cancellation |
| | 6 | Race-proof search | refs, request IDs |
| **Part 3** | 7 | Keyboard navigation | refs to DOM, `useLayoutEffect` |
| *Make it good* | 8 | 40 rows that don't lag | `memo`, `useCallback`, `useMemo` |
| **Part 4** | 9 | Workspaces that persist | custom hooks, lazy init |
| *Wire up the app* | 10 | Live sync from the backend | subscriptions, singletons |
| | 11 | The face shell | context vs prop drilling |
| | 12 | A dropdown with no flash | `useLayoutEffect`, observers |
| **Part 5** | 13 | The note editor | controlled vs uncontrolled |
| *Harden and ship* | 14 | Crash isolation + code split | error boundaries, `lazy` |
| | 15 | Ship review | the checklist |

Appendices: [trap index](#appendix-a--trap-index) ·
[interview questions](#appendix-b--interview-questions) ·
[glossary](#appendix-c--story--react-glossary) ·
[what to read in the repo](#appendix-d--what-to-read-in-the-repo)

---
---

# Part 1 — Open the shop

## Task 0 — Turn the lights on

> 🏪 **The shop**
> You have the keys. The window is empty, the shutters are down. Before you can
> put anything in it, you need to tell Robo where the window actually is.

🎯 **The task:** mount a React app onto one DOM node.

🔨 **Build it**

```jsx
// src/app/main.jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

That's the entire bridge between the HTML page and React. One `<div id="root">`
in `index.html`; from here down, React owns it.

> **🧸 Five-year-old**
> You point at the window and tell Robo: *"this one. This is the window you
> look after. Everything behind that glass is yours now, and I promise I will
> never reach in and move a toy myself."*
>
> **🧒 Ten-year-old**
> `createRoot` hands one DOM node over to React permanently. React will
> add, remove and update everything inside it. If you also mutate that subtree
> yourself with `document.querySelector(...).innerHTML = ...`, React doesn't
> know, and the next render will silently stomp your change — or worse, won't,
> and now the screen and the state disagree with no error anywhere.

### What `StrictMode` is for

In **development only**, StrictMode mounts every component, unmounts it, and
mounts it again. It also calls your component functions twice. You will hit
this in Task 4 and think something is broken. It isn't.

> **🧸 Five-year-old**
> The day before opening, the manager makes you set the window up, pack it all
> away, and then set it up **again**. It feels like a waste of time. It isn't —
> she's checking whether you remembered to switch the fairy lights *off* when
> you packed up. If you did it properly, doing it twice changes nothing at all.
> If you forgot, there are now two sets of lights on, and everybody can see it.
>
> **🧒 Ten-year-old**
> Production mounts once, so "my app breaks in StrictMode" is never a StrictMode
> bug — it's a missing cleanup that was already there, just invisible until
> something made it happen twice. Finding it on practice day beats finding it
> when a user leaves the app open for eight hours.

📂 **In the real codebase:** `src/app/main.jsx` — plus it imports
`electron-shim` and `initChromePolyfill()` before rendering, because this same
React tree has to run inside a Tauri window *and* inside a Chrome extension
page. There are four entry points (`main`, `extension-main`, `spotlight-main`,
`handle-main`) rendering different roots from the same `src/`.

✅ **Checkpoint:** a blank page with no console errors.

---

## Task 1 — Put one toy in the window

> 🏪 **The shop**
> One shelf. One toy. You don't arrange it yourself — you write a card
> describing what the shelf should look like, and Robo builds it.

🎯 **The task:** a `ResultItem` — one row in the search results.

🔨 **Build it**

```jsx
// src/features/spotlight/ResultItem.jsx
export function ResultItem({ item, isSelected, onSelect }) {
  return (
    <div
      className={`result-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(item)}
    >
      <span className="result-icon">{item.icon}</span>
      <span className="result-title">{item.title}</span>
      <span className="result-badge">{item.type}</span>
    </div>
  );
}
```

Three things are happening, and all three get asked about in interviews.

**1. A component is just a function.** Takes an object (props), returns JSX.
No class, no lifecycle, no `this`.

**2. Props are read-only.** `item` came from the parent. You never write
`item.title = 'x'`. Data flows **down** as props; changes flow **up** through
callbacks like `onSelect`.

**3. JSX is not HTML.** It compiles to function calls, which is why it's
`className` not `class` (reserved word), and why `{}` holds an **expression**
— you can't put an `if` statement inside one. Hence the `? :` you see
everywhere.

> **🧸 Five-year-old**
> You are not allowed to touch the shop window. Not even a little bit. If you
> want a red car on the shelf, you write "red car" on a card and Robo goes and
> puts it there. Every single time.
>
> A **note pinned to the toy** — "this one is selected," "this one's a tab" —
> is a **prop**. Robo reads it. You don't get to scribble on someone else's
> note; if you want a change, you tell the person who pinned it.
>
> **🧒 Ten-year-old**
> The old way (jQuery) was reaching in and moving one toy at a time. Fine until
> there are fifteen different reasons a toy might move — then you forget one,
> the window stops matching your notes, and nobody can tell which is right.
>
> React's deal: you only ever describe what the *finished* shelf looks like for
> the information you have right now, and it works out the smallest set of real
> DOM moves to get there. One-way data flow (down via props, up via callbacks)
> is what makes it possible to answer "why does the screen look like this?" by
> reading upward instead of searching the whole codebase for who touched it.

📂 **In the real codebase:** `GlobalSpotlight.jsx:2763`. Same idea, plus a
folder-tree chevron, per-file-extension icon colours, a favicon fallback chain,
and a pin button. It takes 13 props. Note that it's wrapped in `memo(...)` —
that's Task 8, ignore it for now.

✅ **Checkpoint:** `<ResultItem item={{icon:'🌐', title:'GitHub', type:'tab'}} />`
renders a row.

---

## Task 2 — The notebook

> 🏪 **The shop**
> A customer walks in and starts describing what they want. You need somewhere
> to write it down — and the window needs to keep up with what you've written.

🎯 **The task:** a search input whose value lives in React.

🔨 **Build it**

```jsx
// src/features/spotlight/GlobalSpotlight.jsx
import { useState } from 'react';

export function GlobalSpotlight() {
  const [query, setQuery] = useState('');

  return (
    <div className="spotlight">
      <input
        className="spotlight-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search apps, tabs, files…"
        autoFocus
      />
      <div className="spotlight-hint">You typed: {query}</div>
    </div>
  );
}
```

`useState` gives you a value and a setter. Calling the setter asks React to
re-render; it does **not** change `query` on the line below.

```jsx
setQuery('abc');
console.log(query);   // still '' — this render's snapshot
```

> **🧸 Five-year-old**
> Your **notebook** is where you write what's true right now. When you write
> something new, the window does **not** change that very second. Robo finishes
> what he's doing first, *then* goes and fixes it. So if you glance at the
> window immediately after writing, you still see the old toys. Nothing is
> broken — Robo just hasn't got there yet.
>
> **🧒 Ten-year-old**
> The `query` variable inside your function is a **photo** of the notebook page,
> taken when this render started. Photos don't update. `setQuery` writes on the
> real page and *asks* for a re-render; you'll see the new value on the next
> render, when a fresh photo is taken.
>
> Hold on to "photo" — in Task 6 you'll hand one to a helper and cause the most
> common bug in React.

### Controlled inputs

`value={query}` + `onChange` means React is the source of truth: the DOM input
can't hold anything React didn't put there. The alternative (`defaultValue` +
read it later via a ref) is **uncontrolled** — the DOM is the truth. You'll
need that in Task 13.

⚠️ **The trap: `value={undefined}`**

```jsx
<input value={settings.apiKey} />        // undefined on first load
```
React logs *"A component is changing an uncontrolled input to be controlled."*
The input started uncontrolled (because `value` was `undefined`), then data
loaded and it became controlled. Fix: `value={settings.apiKey ?? ''}`.

📂 **In the real codebase:** `GlobalSpotlight.jsx:244`. That component has
**27** `useState` calls — `query`, `results`, `selectedIndex`, `pinnedItems`,
`loading`, `commandMode`… We'll add several of them over the next tasks, and
in Task 15 we'll talk about why 27 is too many.

✅ **Checkpoint:** typing updates the hint text live.

---

## Task 3 — A shelf full of toys

> 🏪 **The shop**
> One toy is easy. Now put twenty in, and let the customer take one out of the
> middle.

🎯 **The task:** render a list of results.

🔨 **Build it**

```jsx
const [results, setResults] = useState([]);

// …
<div className="results">
  {results.length > 0 ? (
    results.map((item) => (
      <ResultItem
        key={item.id}                          // ← the important bit
        item={item}
        isSelected={item.id === selectedId}
        onSelect={handleSelect}
      />
    ))
  ) : (
    <div className="empty">No results</div>
  )}
</div>
```

### Why `key` exists

React doesn't diff your whole tree from scratch. It follows three rules:

1. Different element **type** in the same slot → destroy that subtree, rebuild
   it (everything inside loses its state).
2. Same type → keep the DOM node, patch what changed, recurse.
3. For **lists** → match children up by `key`.

> **🧸 Five-year-old**
> Every toy in the window wears a **name tag**: "Teddy," "Red Car," "Rocket."
> When your notebook changes, Robo reads the tags to work out what happened.
> Teddy's gone? The other tags are still there, so he just slides them along.
> Easy.
>
> Now take the name tags off and label them by **where they're standing**
> instead — "toy 1, toy 2, toy 3." Take toy 2 away. Robo looks and thinks:
> *"toy 3 turned into toy 2!"* So he leaves toy 2's little hat on the wrong
> bear. The toys are all correct. Their hats are shuffled along by one.
>
> **🧒 Ten-year-old**
> The "hat" is anything the row owned by itself: a broken-image flag, whether
> it's expanded, text typed into it, the actual DOM node underneath. A stable
> id means "same toy, it moved." A position index means "whatever is standing
> here now" — so removing from the middle makes every later row inherit its
> neighbour's leftovers.

⚠️ **The trap: index as key — and it's live in this repo**

```jsx
// GlobalSpotlight.jsx:2181 / :2221 — context rows, index-keyed, AND closable
<ContextItem key={`app-${i}`}  … onClose={handleContextClose} />
<ContextItem key={`tab-${i}`}  … onClose={handleContextClose} />

// GlobalSpotlight.jsx:2263 — pinned rows, index-keyed, AND removable
<PinItem     key={`pin-${i}`}  … onRemove={removePin} />
```

Close the 2nd of 5 open tabs and React reuses DOM node #2 for what was tab #3.
`ContextItem` is `memo`'d and holds its own `iconError` state, so the wrong row
can inherit a broken-icon flag. It's mostly cosmetic *today* only because the
list reloads 500 ms later (`:1876`) — which is exactly why nobody has noticed.
Everything in those lists already has an `id` to key by.

**Rule:** index keys are safe only if the list is never reordered, filtered, or
removed from. The moment someone adds a delete button, they're a bug.

⚠️ **The trap: `0` renders as `0`**

```jsx
{results.length && <List />}      // renders a bare "0" when empty
{results.length > 0 && <List />}  // correct
```
`&&` returns the left side when it's falsy, and React renders `0` — it only
skips `false`, `null`, and `undefined`. Any stray `0` in a UI is this bug.

📂 **In the real codebase:** `GlobalSpotlight.jsx:2402` —
`key={row.item.id || index}`. The fallback is there for synthetic rows with no
id; the primary path is a real id.

✅ **Checkpoint:** hardcode 5 results, render them, delete the middle one —
nothing shifts.

---
---

# Part 2 — Call the storeroom

## Task 4 — The storeroom phone

> 🏪 **The shop**
> The toys aren't in the window — they're out the back. To find out what's on
> the shelves you have to pick up the phone, and the phone is not part of the
> window.

🎯 **The task:** fetch real results from the Rust sidecar on port 4545.

🔨 **Build it**

```jsx
import { useEffect } from 'react';
import { SIDECAR_URL } from '../../shared/config/sidecar';   // always 127.0.0.1

useEffect(() => {
  if (!query.trim()) {
    setResults([]);
    return;
  }

  fetch(`${SIDECAR_URL}/search?q=${encodeURIComponent(query)}&limit=15`)
    .then(r => r.json())
    .then(setResults)
    .catch(err => console.error('[Spotlight] search failed:', err));
}, [query]);
```

This works. It is also wrong in three ways, and you'll fix each one in Tasks
5, 6 and 14. First, the idea itself.

### `useEffect` is not a lifecycle

The wrong mental model is "`useEffect` is `componentDidMount`." The right one:

> **An effect synchronizes your component with something outside React.** The
> dependency array says what that synchronization depends on. The cleanup
> function undoes it.

> **🧸 Five-year-old**
> Some things are **not inside the window**. The fairy lights. The doorbell.
> The telephone to the storeroom. Robo only ever arranges toys — he will not
> touch any of that. So *you* keep a little list of "things outside the window
> I need to switch on." That list is an **effect**.
>
> And there's a rule you must never break: **anything you switch on, you have
> to be able to switch off.** Turn the fairy lights on for the teddy display,
> and you must turn them off when the teddies go — otherwise the next display
> has old lights buzzing behind it, and after a week there are forty sets of
> lights all still on.
>
> **🧒 Ten-year-old**
> Those forty sets of lights are a **memory leak**, and the switch-off is the
> **cleanup function** you return from the effect. The dependency array is you
> saying "this only needs redoing when *these* notebook lines change" — and
> when they do, React switches the old one off *first*, then switches the new
> one on. `[]` means "doesn't depend on the notebook at all," which is only
> true if the effect never reads anything that changes. Lie about that and you
> get Task 6's bug.

### The shape to memorise

```jsx
useEffect(() => {
  const thing = subscribe();
  return () => thing.unsubscribe();     // ALWAYS
}, [deps]);
```

Everything that needs cleanup:

| You start | You must stop |
|---|---|
| `addEventListener` | `removeEventListener` — **same function reference** |
| `setTimeout` / `setInterval` | `clearTimeout` / `clearInterval` |
| `requestAnimationFrame` | `cancelAnimationFrame` |
| `ResizeObserver` / `IntersectionObserver` | `.disconnect()` |
| `getUserMedia` | `.stop()` on every track |
| `AudioContext` | `.close()` |
| Tauri `listen()` | call the returned unlisten fn |

The gotcha on line 1: `removeEventListener` matches by **reference**. An inline
arrow removes nothing:

```jsx
window.addEventListener('resize', () => f());
return () => window.removeEventListener('resize', () => f());   // different fn → leak
```

### Conditional subscription

Subscribe only while you need to, by returning early *before* subscribing:

```jsx
// GlobalSpotlight.jsx:332
useEffect(() => {
    if (!wsDropdownOpen) return;                 // nothing to sync
    const handler = (e) => { …close on outside click… };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
}, [wsDropdownOpen]);
```

When the dropdown closes, React runs the cleanup, re-runs the effect, and it
immediately returns. Copy this pattern.

### Effects you should delete

The most common React review comment is *this effect shouldn't exist.*

```jsx
// ANTI-PATTERN
const [total, setTotal] = useState(0);
useEffect(() => { setTotal(tabs.length + apps.length); }, [tabs, apps]);

// FIX
const total = tabs.length + apps.length;
```

> **🧸 Five-year-old**
> If you can work something out just by **looking at your own notebook** — "3
> teddies and 2 cars means 5 toys" — you don't need to phone anybody. Just
> count it. Effects are for the storeroom phone and the fairy lights, not for
> counting things you already know.
>
> **🧒 Ten-year-old**
> The bad version writes "5" onto a second notebook page and asks Robo to redo
> the window *again*. So it renders twice, and for one frame the user sees the
> stale total. Three questions, in order: Can I compute it during render? Then
> do. Did it happen because the user *did* something? Then it belongs in the
> event handler. Does it sync with something outside React (DOM, timer, socket,
> Tauri, `chrome.*`)? Only then is it an effect.

⚠️ **The trap: the effect cascade**

`App.jsx:686-736` has six effects in a row, each writing one key to
`localStorage`:

```jsx
useEffect(() => { localStorage.setItem('showPingsSection', String(showPingsSection)); }, [showPingsSection]);
useEffect(() => { localStorage.setItem('showFeedSection',  String(showFeedSection));  }, [showFeedSection]);
useEffect(() => { localStorage.setItem('wallpaperUrl', wallpaperUrl); … },             [wallpaperUrl, wallpaperEnabled]);
// …three more
```

Each is harmless alone. Together they smear the persistence logic across 50
lines and turn every settings toggle into a render→effect→write cycle. Better:
persist in the handler where the user actually clicked, or extract one
`usePersistedState(key, initial)` hook (Task 9) and delete all six.

The worse version is the **chain**: effect A sets state B, whose effect sets
state C. Every link is another render, and a cycle is an infinite loop.

📂 **In the real codebase:** the search effect is
`GlobalSpotlight.jsx:1002-1165`. It handles slash commands, `/u` `/a` `/f`
scopes, an LRU cache, natural-language detection, Windows Settings results and
folder-tree expansion — but the skeleton is what you just wrote.

✅ **Checkpoint:** type in the box, real results appear. Type fast and it feels
laggy or flickery — that's Task 5 and 6.

---

## Task 5 — Don't run on every letter

> 🏪 **The shop**
> The customer is saying a word one letter at a time: "c… h… r…". You've been
> sprinting to the storeroom on every letter. Three sprints, and only the last
> one mattered.

🎯 **The task:** debounce the search — without a library.

🔨 **Build it**

```jsx
useEffect(() => {
  if (!query.trim()) { setResults([]); return; }

  const timeoutId = setTimeout(() => {
    fetch(`${SIDECAR_URL}/search?q=${encodeURIComponent(query)}&limit=15`)
      .then(r => r.json())
      .then(setResults)
      .catch(err => console.error('[Spotlight] search failed:', err));
  }, 50);

  return () => clearTimeout(timeoutId);       // ← the whole debounce
}, [query]);
```

That's it. That one cleanup line **is** the debounce.

> **🧸 Five-year-old**
> Instead of sprinting the moment you hear a letter, you wait a tiny moment
> first. If another letter arrives, you **cancel the sprint you hadn't started
> yet** and wait again. You only actually run when they stop talking.
>
> **🧒 Ten-year-old**
> No library, no ref bookkeeping. Each keystroke changes `query` → React runs
> the cleanup for the previous effect (cancelling its pending timeout) → then
> runs the new effect. The cleanup you learned for switching off fairy lights
> turns out to be the same mechanism as cancelling a scheduled action. This is
> worth being able to write on a whiteboard from memory.

📂 **In the real codebase:** `GlobalSpotlight.jsx:1059`. It picks the delay
based on whether there's a cache hit — `const debounceMs = cached ? 100 : 50;`
— because with cached results already on screen there's nothing to wait for.

✅ **Checkpoint:** hold a key down. One request fires, not thirty. (Watch the
Network tab.)

---

## Task 6 — The teddy arrives last

> 🏪 **The shop**
> You phone the storeroom for a teddy. Then you change your mind: a car. Then
> a rocket. But the storeroom is slow and messy, and the people out back don't
> answer in order. **The teddy comes back last.** You put it in the window. The
> customer asked for a rocket.

🎯 **The task:** make sure a stale response can never win.

🔨 **Build it**

```jsx
import { useRef } from 'react';

const searchIdRef = useRef(0);          // ← survives renders, causes none

useEffect(() => {
  if (!query.trim()) { setResults([]); return; }

  const myId = ++searchIdRef.current;   // take a ticket

  const timeoutId = setTimeout(async () => {
    if (searchIdRef.current !== myId) return;              // still mine?
    setLoading(true);
    try {
      const res  = await fetch(`${SIDECAR_URL}/search?q=${encodeURIComponent(query)}`);
      if (searchIdRef.current !== myId) return;            // ← check after EVERY await
      const json = await res.json();
      if (searchIdRef.current !== myId) return;            // ← yes, this one too

      setResults(json);
      setSelectedIndex(json.length > 0 ? 0 : -1);
    } catch (err) {
      console.error('[Spotlight] search failed:', err);
    } finally {
      if (searchIdRef.current === myId) setLoading(false); // ← and here
    }
  }, 50);

  return () => clearTimeout(timeoutId);
}, [query]);
```

> **🧸 Five-year-old**
> Write a **ticket number** on every order you phone through — 1, 2, 3. Keep
> the newest number on a **sticky note in your pocket**. When something turns
> up from the storeroom, look at its ticket and check your pocket. Ticket 1
> arriving when your pocket says 3? That's an old order. Bin it.
>
> Why the pocket and not the notebook? Because the notebook is for things
> customers should **see**, and Robo redoes the whole window every time you
> write in it. Nobody needs to see a ticket number. The pocket is for things
> you just need to *remember*.
>
> **🧒 Ten-year-old**
> A ref is a mutable box that survives re-renders and **doesn't cause one when
> you change it**. That's the whole difference from state, and it's a feature.
> If `searchIdRef` were state, every keystroke would trigger an extra render
> for a number that appears nowhere on screen.
>
> The discipline that matters: **re-check the ticket after every single
> `await`.** Each `await` is a gap where the user may have typed again. One
> check at the top is not enough. Note the `finally` check too — without it, a
> dead request switches off the spinner belonging to a live one.

### The four honest uses of a ref

| Use | Example here |
|---|---|
| A handle to a DOM node | `inputRef.current.focus()` (Task 7) |
| A mutable value nothing displays | `searchIdRef`, timer ids, RAF handles |
| The *latest* value for a long-lived callback | `onChangeRef` (Task 13) |
| "Did this already happen?" | `initRef` in `useSync` (Task 10) |

> **The rule: never read or write a ref during render.** Reads are stale,
> writes make render impure. Refs live in event handlers and effects. Robo
> never looks in your pocket, so the pocket is not part of the picture he's
> drawing — don't mix the two.

### The simpler cousin: a cancelled flag

When you only need "ignore this if we unmounted," you don't need tickets:

```jsx
// WebAppPreviews.jsx:151
useEffect(() => {
    let cancelled = false;
    checkFrameable(app.embedUrl).then(result => {
        if (!cancelled && result !== null) setFrameable(result);
    });
    return () => { cancelled = true; };
}, [app.embedUrl]);
```

The variable is scoped to one effect run, so run *n*'s cleanup only cancels run
*n*. Clean, local, no shared counter.

### And the real answer: `AbortController`

Both of the above just *ignore* the response — the storeroom still did the
work. To actually cancel:

```jsx
useEffect(() => {
  const ac = new AbortController();
  fetch(url, { signal: ac.signal })
    .then(r => r.json()).then(setData)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => ac.abort();
}, [url]);
```

Not used in this codebase — the calls go to `127.0.0.1`, so it genuinely
doesn't matter. Over a real network it does, and interviewers will ask.

⚠️ **The trap this sets up: the stale closure**

You now know refs. The danger is reaching for them to silence a lint warning:

```jsx
// BROKEN
useEffect(() => {
  const id = setInterval(() => console.log(count), 1000);
  return () => clearInterval(id);
}, []);                             // logs 0 forever
```

> **🧸 Five-year-old**
> You take a **photo** of your notebook page and hand it to a helper: "check
> this every minute and tell me the number." Then you carry on writing in the
> notebook all day. But the helper is looking at the photo, and the photo will
> never change. So every minute, all day, they cheerfully tell you this
> morning's number — and they aren't doing anything wrong. You gave them a
> photo.
>
> **🧒 Ten-year-old**
> Every render takes a fresh photo (Task 2). A function created during a render
> keeps *that* render's photo forever. `[]` deps mean it's never re-created, so
> it's frozen at mount time. Three ways out, best first:
> 1. **Hand over a new photo when it changes** — add the value to the deps.
> 2. **Don't name the number at all** — `setCount(c => c + 1)` says "add one to
>    whatever's actually there." No photo needed, so it can't go stale.
> 3. **Point them at your pocket note** — a latest-value ref. Only when
>    re-creating the helper would be destructive (Task 13).

`eslint-plugin-react-hooks` is on repo-wide (`eslint.config.js`) and will catch
most of these. Suppressing it without a written reason is how this bug ships.

📂 **In the real codebase:** `searchIdRef` is declared at
`GlobalSpotlight.jsx:295` and checked at `:1064`, `:1117`, `:1131`, and `:1156`.
Read those four lines together — that's the whole pattern.

✅ **Checkpoint:** throttle the network to Slow 3G, type `chrome` fast. The
list never shows results for a prefix you've moved past.

---
---

# Part 3 — Make it good

## Task 7 — Hands on the toys

> 🏪 **The shop**
> The customer wants to browse with the arrow keys instead of the mouse. The
> highlighted row has to stay visible as they go — which means you need to
> reach out and physically touch that shelf.

🎯 **The task:** arrow-key navigation with auto-scroll.

🔨 **Build it**

```jsx
const [selectedIndex, setSelectedIndex] = useState(-1);
const inputRef = useRef(null);

useEffect(() => {
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      handleClose();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [results, selectedIndex]);
```

Note `setSelectedIndex(i => …)` — the **updater form**. It reads the live value
rather than this render's photo, so the handler can't go stale on `selectedIndex`.

Now scroll the selected row into view, inside `ResultItem`:

```jsx
const rowRef = useRef(null);

useEffect(() => {
  if (isSelected && rowRef.current) {
    rowRef.current.scrollIntoView({ block: 'nearest' });
  }
}, [isSelected]);

return <div ref={rowRef} …>;
```

⚠️ **The trap this creates — and how the real app fixes it**

Ship that and wheel-scrolling a long list fights you. Rows slide underneath the
stationary cursor, each fires `mouseenter`, each selection scrolls *back* to
that row, and you can never reach the bottom.

> **🧸 Five-year-old**
> The window is supposed to slide to whichever toy you're pointing at. But when
> the customer spins the shelf themselves, toys keep sliding past their finger
> — and the window keeps yanking back to whatever just touched it. You need to
> know *why* a toy got picked: because they pointed at it, or because they
> scrolled. Same result, different reason.
>
> **🧒 Ten-year-old**
> "Why did this happen" isn't render state — nothing about it appears on
> screen. That's a pocket note. Set it when the selection comes from hover, and
> have the scroll effect skip that case:

```jsx
// GlobalSpotlight.jsx:2769
const hoverSelectedRef = useRef(false);

const handleMouseEnter = useCallback(() => {
    hoverSelectedRef.current = true;
    onHover(index);
}, [index, onHover]);

useEffect(() => {
    if (isSelected && rowRef.current && !hoverSelectedRef.current) {
        rowRef.current.scrollIntoView({ block: 'nearest' });
    }
    hoverSelectedRef.current = false;      // reset for next time
}, [isSelected]);
```

A ref carrying **intent** that isn't render state. Good pattern to steal.

📂 **In the real codebase:** the keyboard model is much richer — Tab cycles
sections, ←/→ switch workspaces, `selectedPinIndex` uses a range encoding to
address pins, workspaces and context rows with one number.

✅ **Checkpoint:** ↑/↓ moves the highlight and scrolls it into view; wheel
scrolling doesn't fight back.

---

## Task 8 — Forty shelves, one keystroke

> 🏪 **The shop**
> Every time you write in the notebook, Robo walks past **every single shelf**
> and checks it. Four shelves, fine. Forty, and the window visibly stutters
> while the customer is still talking.

🎯 **The task:** make one keystroke re-render two rows, not forty.

🔨 **Build it**

```jsx
import { memo, useCallback, useMemo } from 'react';

const ResultItem = memo(function ResultItem({ item, index, isSelected, onSelect, onHover }) {
  const handleClick      = useCallback(() => onSelect(item),  [item, onSelect]);
  const handleMouseEnter = useCallback(() => onHover(index),  [index, onHover]);
  // …
});
```

And in the parent — stable callbacks, memoized derived lists:

```jsx
const handleSelect = useCallback((item) => { …open it… }, []);
const handleHover  = useCallback((i) => setSelectedIndex(i), []);

const visibleRows = useMemo(
  () => results.slice(0, showAll ? results.length : 10),
  [results, showAll]
);
```

Now pressing ↓ changes `selectedIndex`, which flips `isSelected` on exactly two
rows. The other 38 skip.

> **🧸 Five-year-old**
> You clip a label to each shelf saying: *"if this label hasn't changed, don't
> bother with this shelf."* Now Robo walks past and only stops at the shelves
> whose labels are different. That's `memo`.
>
> But here's the catch, and it's the thing everyone gets wrong. **Robo checks
> the paper, not the words.** If you write out a brand-new label every single
> time — same words, fresh bit of paper — he looks at it and says "new label!"
> and redoes the shelf anyway. You did all that work for nothing.
>
> **🧒 Ten-year-old**
> "New paper, same words" is an inline `{}`, `[]`, or `() => …` in your JSX: a
> fresh object/array/function every render, never `===` the previous one. So
> `memo` on the child is defeated by the parent, and you've *added* the cost of
> the comparison on top of the render you were trying to avoid.
>
> `useMemo` and `useCallback` are how you hand back **the same piece of paper**
> when the words haven't changed. All three tools are useless alone — they only
> pay off when something downstream is doing that paper-check.

⚠️ **The trap: memo defeated by inline props**

```jsx
<ResultItem onSelect={() => pick(item)} />   // new fn every render → memo dead
<ResultItem style={{ margin: 4 }} />          // new object every render → memo dead
```

Fix: hoist to `useCallback`, and have the child pass the item back —
`onSelect(item)` — which is exactly what `ResultItem` and `PinItem` do.

### "Paper, not words" is the same rule as immutability

You already met this in a different costume. React compares with `Object.is`,
which is reference equality, everywhere:

```jsx
items.push(newItem);
setItems(items);          // same paper → React sees no change → nothing happens
setItems(p => [...p, x]); // new paper → re-render
```

The insidious part of mutation bugs is that they sometimes appear to work —
an unrelated `setState` triggers a render that happens to read the mutated
object. Then they stop working after a refactor three months later. Watch
`.sort()` and `.reverse()` especially: they scribble on the page in place.

### When *not* to reach for this

Memoization costs real work: the dep array is allocated and compared every
render. For a component rendering five divs, `memo` is net-negative. Reach for
it when you have (a) a measured problem, (b) a big list, or (c) a genuinely
expensive computation.

> **React 19 note:** the React Compiler can insert all of this automatically,
> but this project doesn't use it — no `babel-plugin-react-compiler` in
> `vite.config.js`. Every memo here is manual and load-bearing.

📂 **In the real codebase:** `GlobalSpotlight.jsx:2664`, `:2706`, `:2763` —
`PinItem`, `ContextItem`, `ResultItem` all `memo`'d. Derived lists memoized at
`:1167` (`baseRows`), `:1174` (`flatRows`), `:1233` (`contextGroups`), `:1255`
(`wsNavItems`).

✅ **Checkpoint:** React DevTools → Profiler → "highlight updates." Press ↓ and
watch only two rows flash.

---
---

# Part 4 — Wire up the real app

## Task 9 — Recipe cards

> 🏪 **The shop**
> You keep doing the same three things every morning: switch the doorbell on,
> listen for it, switch it off at closing. Write it down once.

🎯 **The task:** extract a custom hook, and load workspaces from IndexedDB.

🔨 **Build it**

```jsx
// src/shared/hooks/useWorkspaces.js
import { useCallback, useEffect, useState } from 'react';
import { listWorkspaces, subscribeWorkspaceChanges } from '../../db/index.js';

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading]       = useState(true);

  const refresh = useCallback(async () => {
    const result = await listWorkspaces({ limit: 1000 });
    if (result?.success) setWorkspaces(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    return subscribeWorkspaceChanges(refresh);   // sub returns its own unsub
  }, [refresh]);

  return { workspaces, loading, refresh };
}
```

Now any component: `const { workspaces, loading } = useWorkspaces();`

> **🧸 Five-year-old**
> You write the doorbell steps on a **recipe card**, and anyone can follow the
> card instead of memorising them.
>
> The important bit: the card tells you *how to have* a doorbell. It is **not**
> a shared doorbell. Sam follows the card and gets Sam's doorbell. Mia follows
> it and gets Mia's. Same instructions, different bells.
>
> **🧒 Ten-year-old**
> That's the difference between sharing **logic** and sharing **state**. Two
> components calling `useWorkspaces()` each get their own `workspaces` array
> and their own subscription. If you want one genuinely shared value it has to
> live outside React — a context (Task 11), or a module singleton, which is
> what `syncOrchestrator` and `teamManager` are in this app.

### Lazy initializers — free performance

Loading from cache so the UI doesn't flash blank:

```jsx
// WRONG — parses localStorage on EVERY render, throws the result away
const [data, setData] = useState(JSON.parse(localStorage.getItem(KEY)));

// RIGHT — runs once
const [data, setData] = useState(() => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
});
```

Non-obvious because the wrong version *works*. You just pay for a
`localStorage` read and a `JSON.parse` on every keystroke, forever.

### The rules of hooks, and why they exist

1. Only call hooks at the top level — never in a condition, loop, or nested
   function.
2. Only call them from components or other hooks.

> **🧸 Five-year-old**
> Behind the counter is a row of **numbered drawers**. Drawer 1, drawer 2,
> drawer 3. Every morning you open them in that exact order.
>
> The drawers have no labels on the front. You know what's in drawer 2 *only*
> because it's the second one you open. So if one morning you skip drawer 2,
> everything after it comes out of the wrong drawer — you reach for sweets and
> get socks, and every drawer after that is wrong too.
>
> **🧒 Ten-year-old**
> React stores hook state in an array and walks it **by position**, not by
> variable name — it has no idea you called it `query`. Put a `useState` inside
> an `if`, a loop, or after an early `return`, and on the render where it's
> skipped, every later hook shifts down a slot and reads its neighbour's value.

⚠️ **The trap: early return above a hook**

```jsx
export function Panel({ isOpen }) {
  if (!isOpen) return null;        // ← every hook below is now conditional
  const [x, setX] = useState(0);   // 💥 "Rendered fewer hooks than expected"
}
```

All hooks first, `return null` after. This bites hardest during refactors —
someone adds a guard at the top of a 300-line component and the crash surfaces
three components away.

📂 **In the real codebase:** the clean hooks to read, in order —
`useIsSidebarWidth.js` (20 lines, textbook), `useDashboardData.js:108` (the
lazy-init cache trick), `useOnboarding.js`, `useSlashCommands.js`,
`useVoiceCommands.js`, `useUpdateAvailable.js`, `useDockState.js`.

✅ **Checkpoint:** workspaces load, and adding one in another window updates
this one.

---

## Task 10 — The world outside

> 🏪 **The shop**
> The storeroom now phones **you**. So does the shop next door, and head
> office. You need to answer all three without ending up with forty phones off
> the hook.

🎯 **The task:** subscribe to the live sync layer.

CoolDesk talks to four external systems, all through effects:

| System | Where | Pattern |
|---|---|---|
| `chrome.*` extension APIs | `WorkspaceShell.jsx:41` | `addListener` / `removeListener` |
| Tauri IPC + window events | `WebAppPreviews.jsx:243` | `invoke()`, `listen()` → unlisten |
| WebSocket on 4545 | `useSync` → `syncWebSocket.js` | orchestrator events → unsub |
| IndexedDB | `db/index.js` | `subscribeWorkspaceChanges` |

🔨 **Build it**

```jsx
// src/shared/hooks/useSync.js  (simplified)
export function useSync() {
  const [syncStatus, setSyncStatus] = useState('idle');
  const [error, setError] = useState(null);
  const initRef = useRef(false);

  // Effect 1 — one-time init of a process-wide singleton
  useEffect(() => {
    if (initRef.current) return;        // StrictMode double-mount guard
    initRef.current = true;
    syncOrchestrator.init().catch(e => setError(e.message));
  }, []);

  // Effect 2 — event subscriptions, with their own lifetime
  useEffect(() => {
    const unsubs = [
      syncOrchestrator.on('sync-start',    () => { setSyncStatus('syncing'); setError(null); }),
      syncOrchestrator.on('sync-complete', () => setSyncStatus('idle')),
      syncOrchestrator.on('sync-error',    (e) => { setSyncStatus('error'); setError(String(e)); }),
    ];
    return () => unsubs.forEach(u => u?.());
  }, []);

  return { syncStatus, error };
}
```

**Two effects, not one.** Different lifetimes → different effects. Init happens
once ever; subscriptions come and go with the component. Merging them means one
can't change without dragging the other along.

The `initRef` is the StrictMode guard from Task 0. It's justified here because
`syncOrchestrator.init()` starts a process-wide singleton that can't be
un-started — there's no honest cleanup to write. When there *is* one, write it
instead of reaching for a guard.

⚠️ **The trap: async subscriptions that outlive their cleanup**

If you create the subscription *asynchronously*, cleanup can run before it
exists — and then it leaks forever, invisibly.

```jsx
// WebAppPreviews.jsx:243 — the correct handling
let stopped = false;
let unlisteners = [];

import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
  const w = getCurrentWindow();
  Promise.all([
    w.listen('tauri://move',   invalidateAndSync),
    w.listen('tauri://resize', invalidateAndSync),
  ]).then(us => {
    if (stopped) us.forEach(u => u());   // ← already torn down: unsubscribe now
    else unlisteners = us;
  });
});

return () => { stopped = true; unlisteners.forEach(u => u()); };
```

Miss that `if (stopped)` and you leak one listener per mount. In StrictMode
you'd leak on the very first render — which is precisely the kind of thing
StrictMode exists to expose.

> **🧒 Ten-year-old (bonus)**
> React has a purpose-built hook for this: `useSyncExternalStore`. It's not used
> in this codebase, but interviewers ask why you'd prefer it — because with
> concurrent rendering, the effect-based version can show a **torn** value for
> one frame (part of the UI reading the old store value, part reading the new).
> `useSyncExternalStore` is built to make that impossible.

📂 **In the real codebase:** `src/shared/hooks/useSync.js` — read it whole,
it's the best-shaped hook in the repo.

✅ **Checkpoint:** change a workspace in the Chrome extension, watch the
desktop app update without a refresh.

---

## Task 11 — The shell

> 🏪 **The shop**
> You now have three window displays and a way to slide between them. And
> today's shop colour is blue — which Sam needs to tell Ravi, who tells Mia,
> who is the only one who actually cares.

🎯 **The task:** the face shell (workspace / tabs / team) with spatial nav.

🔨 **Build it**

```jsx
// src/faces/shell/WorkspaceShell.jsx
const WorkspaceFaceContext = React.createContext({
  currentFace: 'overview',
  isDesktopApp: false,
});

export function WorkspaceShell({ children, activeFace = 'overview', onFaceChange, isDesktopApp }) {
  const [currentFace, setCurrentFace] = useState(activeFace);

  const navigateToFace = useCallback((face) => {
    if (face === currentFace) return;
    setCurrentFace(face);
    onFaceChange?.(face);
  }, [currentFace, onFaceChange]);

  const ctx = useMemo(() => ({ currentFace, isDesktopApp }), [currentFace, isDesktopApp]);

  return (
    <WorkspaceFaceContext.Provider value={ctx}>
      <div className="workspace-faces">{children}</div>
    </WorkspaceFaceContext.Provider>
  );
}
```

> **🧸 Five-year-old**
> You whisper "it's blue" to Sam, Sam whispers it to Ravi, Ravi whispers it to
> Mia, and Mia is the only one who needed it. Three people carried a message
> that meant nothing to them.
>
> Instead, put a big **poster on the wall**: "TODAY: BLUE." Anyone who needs it
> looks up.
>
> **🧒 Ten-year-old**
> The whispering is **prop drilling**; the poster is **context**. But posters
> have a catch: when you change the poster, *everyone* who ever looks at that
> wall stops and redoes their shelf — even someone who only cared about a
> different line on it. There's no "wake me only if the colour changes." So
> context suits things that rarely change (theme, language, who's logged in),
> and makes a poor state manager. If it hurts, put up two smaller posters.

⚠️ **The trap: a new poster every render**

```jsx
// BAD — new object identity each render → every consumer re-renders, always
<Ctx.Provider value={{ currentFace, isDesktopApp }}>

// GOOD — same paper unless the words changed
const ctx = useMemo(() => ({ currentFace, isDesktopApp }), [currentFace, isDesktopApp]);
<Ctx.Provider value={ctx}>
```

Same "paper, not words" rule from Task 8. It shows up in every corner of React
once you know to look for it.

📂 **In the real codebase:** `WorkspaceShell.jsx:24` is the **only**
`createContext` in the whole app. Everything else is props plus module
singletons — a deliberate trade of fewer abstractions for more plumbing. You
can see the bill at `App.jsx:1351`: one `<CoolDeskContainer>` call spanning 120
lines with **44 props**, most of them inline arrow functions.

✅ **Checkpoint:** Ctrl+← / Ctrl+→ slide between faces.

---

## Task 12 — No flash

> 🏪 **The shop**
> The workspace menu drops down from its button — except for one frame it
> appears in the top-left corner and then jumps. Customers notice.

🎯 **The task:** measure, then position, before the browser paints.

🔨 **Build it**

```jsx
useLayoutEffect(() => {
  if (!wsDropdownOpen) { setWsMenuStyle(null); return; }

  const measure = () => {
    const trigger = wsDropdownRef.current?.querySelector('.ws-dropdown-trigger');
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const openDown = spaceBelow >= Math.min(220, spaceAbove);

    setWsMenuStyle({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 268)),
      maxHeight: Math.max(80, Math.min(220, openDown ? spaceBelow : spaceAbove)),
      ...(openDown ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    });
  };

  measure();
  const ro = new ResizeObserver(measure);      // re-measure while content loads in
  if (containerRef.current) ro.observe(containerRef.current);
  return () => ro.disconnect();
}, [wsDropdownOpen]);
```

> **🧸 Five-year-old**
> Normally Robo puts the toys out and then *afterwards* you tidy up the
> positions — so for a split second the customer sees them in the wrong place.
> `useLayoutEffect` is you saying: **"stop. Don't open the shutters yet."**
> Measure, position, *then* let them look.
>
> **🧒 Ten-year-old**
> `useEffect` runs after paint; `useLayoutEffect` runs after DOM mutation but
> **before** paint. Any measure-then-position work belongs in the layout
> variant, or the user sees one frame of the wrong thing. The cost is that it
> **blocks painting** — so never put anything slow in there.

📂 **In the real codebase:** `GlobalSpotlight.jsx:348` is the code above.
`App.jsx:701` uses it to add `body.wallpaper-enabled` before paint, so the
theme background never flashes through the wallpaper.

⚠️ **The trap next door: layout thrash**

`WebAppPreviews.jsx:180-200` walks the entire ancestor chain calling
`getComputedStyle` + `getBoundingClientRect` per element — on a 250 ms interval
*and* on every `scroll` event in capture phase (so: every scrolling element in
the app). Each `getBoundingClientRect()` after a style write forces a
synchronous layout.

The RAF coalescing (`cancelAnimationFrame` → `requestAnimationFrame`) is the
only reason this doesn't tank the frame rate. **That guard is load-bearing.**
Don't "simplify" it away.

✅ **Checkpoint:** open the dropdown near the bottom of the screen — it opens
upward, with no jump.

---
---

# Part 5 — Harden and ship

## Task 13 — A shelf that knows its own job

> 🏪 **The shop**
> The note editor is not a shelf you arrange. It's a shelf that keeps its own
> little notebook, and if you shove your notebook onto it while a customer is
> writing, you rub out their sentence.

🎯 **The task:** wrap Tiptap without fighting it.

🔨 **Build it**

```jsx
// src/faces/workspace/parts/editor/TiptapEditor.jsx
const onChangeRef = useRef(onChange);
useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

const debouncedOnChange = useCallback((html) => {
  clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => onChangeRef.current(html), 150);
}, []);                                   // ← [] is safe ONLY because of the ref

const editor = useEditor({
  extensions,
  content,                                // initial content only
  editable: isEditable,
  onUpdate: ({ editor }) => debouncedOnChange(editor.getHTML()),
}, []);                                   // ← created ONCE. This is the design.

// External content pushes (switching notes), guarded against cursor jumps
useEffect(() => {
  if (editor && content !== editor.getHTML()) {
    if (!editor.isFocused) editor.commands.setContent(content || '');
  }
}, [content, editor]);
```

> **🧸 Five-year-old**
> **Controlled** means your notebook is the boss — the shelf just copies it,
> always. **Uncontrolled** means you let that one shelf keep its own little
> notebook. You don't tell it what to hold; you walk over and peek when you
> need to know. Handy when the shelf genuinely knows its job better than you do.
>
> **🧒 Ten-year-old**
> Tiptap owns its document model, its undo history, and its cursor position.
> Recreating the editor throws all three away, so `useEditor(..., [])` — created
> once, never again. But then `onUpdate` would be frozen on the first render's
> `onChange` (the stale-closure photo from Task 6). The **latest-value ref** is
> what makes those empty deps honest: the callback identity never changes, but
> what it calls is always current.

**Every latest-value ref deserves a comment saying why re-running is
unacceptable.** `TiptapEditor.jsx:118` does exactly that. Without one, you can't
tell a justified ref from someone silencing the linter — and the ref version has
no lint coverage, so nothing will warn you when the semantics drift.

⚠️ **The trap: the write-back loop**

Type → `onChange` → parent state → new `content` prop → `setContent` → cursor
jumps to position 0. The `!editor.isFocused` guard prevents it.

But it's a **heuristic, not a proof**, and the failure mode is real: an autosave
or a remote Yjs sync landing *while the user is typing* is silently dropped,
because the editor is focused. The comment at `:148` admits it ("For now, we
only update if focus is not on editor").

The proper fix for a collaborative editor is to compare document versions and
apply remote changes as a transaction that preserves the local selection, rather
than `setContent`, which blows away the whole document. That's what Yjs +
`y-prosemirror` is for — and this repo already depends on `yjs`. Flagging it as
a known limitation, not a casual fix.

✅ **Checkpoint:** switch notes — content changes. Type in one — the cursor
stays where you left it.

---

## Task 14 — Don't let one shelf close the shop

> 🏪 **The shop**
> A shelf falls over. If the whole window goes dark and empty, customers walk
> away. You need a card.

🎯 **The task:** crash isolation and code splitting.

🔨 **Build it**

```jsx
// src/app/App.jsx:57
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary caught error:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error">
          <div>Something went wrong while rendering this section.</div>
          <button onClick={() => this.setState({ hasError: false, error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Still the one thing with no hook equivalent. `getDerivedStateFromError` is pure
and sets the fallback; `componentDidCatch` does the side effects (logging).

> **🧸 Five-year-old**
> Keep a card that says **"Sorry, this shelf is being fixed."** Put it over the
> one shelf that fell. Everything else stays lit and the shop keeps trading.
>
> **🧒 Ten-year-old**
> The card only catches a shelf falling **while Robo is arranging the window**.
> If the storeroom call goes wrong an hour later, or a customer presses a button
> and *that* throws, the card never appears — boundaries don't watch async or
> event handlers. Which is exactly why the search effect has its own
> `try/catch` at `GlobalSpotlight.jsx:1146`.
>
> And put cards over *shelves*, not over the whole shop. A single boundary at
> the very top means any one failure blanks everything — the thing you were
> trying to avoid.

**Not caught by boundaries:** event handlers, `setTimeout`/promise callbacks,
server rendering, and errors thrown by the boundary itself.

### Code splitting

```jsx
// App.jsx:52
const SettingsModal = React.lazy(() =>
  import('../features/settings/SettingsModal').then(m => ({ default: m.SettingsModal })));

// App.jsx:1482
<React.Suspense fallback={null}>
  {showSettings && <SettingsModal … />}
</React.Suspense>
```

The `.then(m => ({ default: … }))` dance is needed because `lazy` requires a
**default** export and these modules use named ones.

⚠️ **The trap: `dangerouslySetInnerHTML`**

```jsx
// src/faces/team/parts/ReadNoteModal.jsx:115
<div dangerouslySetInnerHTML={{ __html: note.payload?.text || '<p>No content</p>' }} />
```

This is an XSS sink, and it's reachable: `note.payload.text` arrives **over P2P
from another team member** — outside this machine's trust boundary. A peer
sending `<img src=x onerror=…>` executes script in the app context, which in a
Tauri app means whatever IPC commands the frontend can invoke.

Fix: sanitize with DOMPurify, or render the Tiptap JSON through a read-only
Tiptap instance instead of raw HTML. Currently gated off by
`TEAM_FEATURE_ENABLED = false` (`src/config/features.js:5`) — so it's a
track-before-ship item, not a live hole.

✅ **Checkpoint:** `throw new Error('boom')` inside one section — that section
shows the card, the rest of the app keeps working.

---

## Task 15 — Ship it

> 🏪 **The shop**
> Opening day. Walk the floor once before you unlock the door.

### The pre-merge checklist

**State**
- [ ] Every `setState` derived from previous state uses the updater form.
- [ ] No mutation — no `.push` / `.sort` / `.reverse` / field writes on state.
- [ ] Expensive `useState` initializers are lazy: `useState(() => …)`.
- [ ] New state actually needs to be state, not derivable during render.

**Effects**
- [ ] Every listener / timer / RAF / observer / stream has a cleanup.
- [ ] `removeEventListener` gets the **same function reference**.
- [ ] Deps are complete, or there's a comment explaining why not.
- [ ] The effect syncs with something outside React (otherwise: delete it).
- [ ] After every `await`, a staleness check or a cancel flag.

**Rendering**
- [ ] `key` is a stable domain id on any list that can reorder or shrink.
- [ ] No inline object/array/function props on `memo`'d children.
- [ ] Conditionals use `> 0` / `Boolean(x)`, not bare `&&` on a number.
- [ ] All hooks precede every early `return`.

**This repo specifically**
- [ ] Don't import another face's `parts/` — eslint enforces it
      (`eslint.config.js:41`).
- [ ] Sidecar URLs come from `shared/config/sidecar.js` — **always
      `127.0.0.1`, never `localhost`**.
- [ ] Sizes use `--font-*` CSS vars from `src/utils/fontUtils.js`, not
      hardcoded `px`.
- [ ] New buttons under `.wallpaper-enabled` need the `:not([class*="awm-"])`
      escape, or the global override clobbers them.
- [ ] `npm run lint` is clean — `react-hooks` rules are **errors** here.

### The thing this codebase is still getting wrong

`App.jsx` is 1,525 lines: 22 `useState`, 28 `useEffect`, and that 44-prop
`<CoolDeskContainer>`. `GlobalSpotlight.jsx` is 2,873 lines with 27 state
variables and 13 effects.

> **🧸 Five-year-old**
> Imagine one shopkeeper personally handling every shelf, every light switch,
> the doorbell, the storeroom phone and the till — all at once, no helpers. It
> works! Right up until you want to change one shelf and can't work out what
> else you're about to break.
>
> **🧒 Ten-year-old**
> Four concrete costs, not aesthetics:
> 1. **Everything re-renders together** — one keystroke re-renders the whole
>    tree. The `memo`'d rows from Task 8 exist specifically to blunt this.
> 2. **Effect interactions become unanalyzable** — 13 effects over 27 state
>    variables means "what runs when I type?" can't be answered by reading.
> 3. **Downstream memoization is off the table** — all 44 props change identity
>    every render, so wrapping that subtree in `memo` would buy exactly nothing.
> 4. **Nothing is testable** in isolation.
>
> The fix isn't a rewrite. Find one clump of state and effects that only talk to
> *each other*, move it onto a recipe card (Task 9), return the minimal surface.
> This repo is already doing it — `useSlashCommands`, `useVoiceCommands`,
> `useDockState`, `useDashboardData` were all carved out of these two files.
> One clump per pull request.

✅ **Final checkpoint:** you have a working spotlight launcher that searches a
real backend, survives fast typing and out-of-order responses, navigates by
keyboard, doesn't re-render forty rows per keystroke, persists workspaces, and
isolates crashes. That's the CoolDesk frontend.

---
---

# Appendix A — Trap index

Every trap in the tutorial, in one place. This is the list to skim the night
before an interview.

| # | Trap | Task | Symptom |
|---|---|---|---|
| 1 | Reaching into React's DOM yourself | 0 | changes vanish on next render |
| 2 | Mutating props | 1 | nothing happens, or spooky action at a distance |
| 3 | `value={undefined}` | 2 | "changing an uncontrolled input to be controlled" |
| 4 | Index as key on a removable list | 3 | row state lands on the wrong row |
| 5 | `{count && <X/>}` | 3 | a bare `0` appears in the UI |
| 6 | Missing effect cleanup | 4 | leaks; doubles under StrictMode |
| 7 | Inline arrow in `removeEventListener` | 4 | listener never removed |
| 8 | Derived state via effect | 4 | double render, one stale frame |
| 9 | The effect cascade / chain | 4 | render storms, sometimes infinite |
| 10 | No debounce on input-driven fetch | 5 | one request per keystroke |
| 11 | Out-of-order async responses | 6 | results for a query you've moved past |
| 12 | Stale closure (`[]` deps + a live value) | 6 | value frozen at mount forever |
| 13 | Hover fighting keyboard auto-scroll | 7 | can't scroll to the end of a list |
| 14 | `memo` defeated by inline props | 8 | memoization silently does nothing |
| 15 | Mutating state (`.push`, `.sort`) | 8 | no re-render; "works" intermittently |
| 16 | Eager `useState` initializer | 9 | hidden cost on every render |
| 17 | Hook after an early `return` | 9 | "Rendered fewer hooks than expected" |
| 18 | Async subscription vs sync cleanup | 10 | one leaked listener per mount |
| 19 | Unmemoized context value | 11 | every consumer re-renders, always |
| 20 | `useEffect` for measure-then-position | 12 | one frame of wrong layout |
| 21 | Layout thrash in a hot loop | 12 | frame rate collapse under scroll |
| 22 | Ref-mirroring to silence the linter | 13 | no lint coverage; drifts silently |
| 23 | Editor write-back loop | 13 | cursor jumps to position 0 |
| 24 | One boundary at the root | 14 | any failure blanks the whole app |
| 25 | `dangerouslySetInnerHTML` on remote data | 14 | XSS with IPC access |
| 26 | The god component | 15 | everything above, at once |

---

# Appendix B — Interview questions

Answered from what you just built.

**Q: What's the difference between state and props?**
Props come from the parent and are read-only; state is owned by the component
and changed through its setter. Both trigger a re-render. In `GlobalSpotlight`,
`variant` is a prop (the parent picks overlay vs embedded), `query` is state.

**Q: Why must state updates be immutable?**
React compares with `Object.is` — the paper, not the words. Mutating keeps the
same reference, so React sees no change and schedules nothing. It also breaks
`memo`, `useMemo` deps, and every other shallow comparison downstream.

**Q: Explain the dependency array.**
It's what the effect's synchronization depends on. React `Object.is`-compares
each entry after every render; if any differ it runs cleanup, then re-runs the
effect. `[]` means "depends on nothing," which is only honest if the effect
closes over nothing that changes.

**Q: `useEffect` vs `useLayoutEffect`?**
`useEffect` runs async after paint; `useLayoutEffect` runs sync after DOM
mutation, before paint. Use the layout one only for measure-then-position work
where the user would otherwise see a flash — `GlobalSpotlight.jsx:348`.

**Q: `useMemo` vs `useCallback` vs `memo`?**
Value / function identity / component. `useCallback(fn, d)` is exactly
`useMemo(() => fn, d)`. All three are useless in isolation — they pay off only
when something downstream does an identity comparison.

**Q: When does `memo` fail to help?**
When any prop is a freshly-allocated object/array/function; when the component
is cheap enough that comparison costs more than rendering; or when it
re-renders for another reason anyway (context change, key change, parent
remount).

**Q: How do you fix a race between two async requests?**
Track a request id in a ref, capture it at request start, bail out after every
`await` if `ref.current` has moved on — `GlobalSpotlight.jsx:1064/1117/1131`.
For unmount-only concerns a `let cancelled = false` closure flag is enough.
To actually stop the request, `AbortController` + abort in cleanup.

**Q: How do you debounce without a library?**
`setTimeout` in the effect body, `clearTimeout` in the cleanup. Each dep change
cancels the pending call. Task 5.

**Q: Why can't you call hooks conditionally?**
React indexes hooks by call position, not name. Skipping one shifts every later
hook to the wrong slot.

**Q: What is a stale closure and how do you avoid it?**
A function still reading a variable captured from an older render. Fix by
adding the dep, using the updater form, or mirroring into a ref that an effect
keeps current — `TiptapEditor.jsx:119`.

**Q: Why does StrictMode double-run effects?**
To surface missing cleanup in development. An effect that can't survive
mount→unmount→mount is broken in production too, just invisibly.

**Q: What don't error boundaries catch?**
Event handlers, async errors, SSR, and errors in the boundary itself.

**Q: When would you reach for Context?**
A value needed by many components at many depths that changes rarely. Not as a
state manager: any change re-renders every consumer, no selectors. This app has
exactly one context and props everywhere else.

**Q: Controlled vs uncontrolled inputs?**
Controlled = `value` + `onChange`, React is truth. Uncontrolled = `defaultValue`
+ ref, the DOM is truth. The warning means `value` was `undefined` on the first
render.

**Q: How does reconciliation work?**
Diff the new tree against the old. Same type in the same slot → patch in place
and recurse. Different type → unmount the subtree and rebuild. Lists match by
`key`. Everything else — index-key bugs, `key`-as-remount-trigger — follows from
those three rules.

**Q: What is the virtual DOM actually for?**
Not "faster than the DOM." It's a batching and diffing layer so you can write
"here's the whole UI for this state" and get minimal mutations out, without
hand-writing the update logic.

**Q: Bonus — how would you reset a subtree's state?**
Change its `key`. `<WorkspaceEditor key={workspaceId} … />` unmounts and
remounts on switch, deleting the need for a "reset the form" sync effect. Costs
a full remount, so not for anything expensive.

---

# Appendix C — Story → React glossary

If you can explain the middle column using the left one, you understand React
well enough to defend it in an interview.

| Toy shop | React | The one-line why |
|---|---|---|
| You never touch the window | you never touch the DOM | one source of truth, so it can't drift |
| Your notebook | **state** | the thing the UI is a function of |
| Robo the window-dresser | **React** | computes the smallest set of DOM changes |
| Robo re-reads the notebook | a **re-render** | your function runs again; the DOM may not change at all |
| A photo of the page | values captured by a render | why `console.log` after `setState` shows the old value |
| A photo handed over forever | a **stale closure** | the function kept an old render's photo |
| Robo checks the paper, not the words | `Object.is` / reference equality | why mutating state changes nothing |
| A fresh page | an immutable update | the only thing React will notice |
| "Add one to whatever's there" | the **updater form** | no photo needed, so it can't go stale |
| A note pinned to a toy | **props** | read-only, flows down |
| Name tags on toys | **`key`** | "same toy, moved" vs "different toy" |
| Numbering by shelf position | an **index key** | breaks the moment anything is removed |
| A toy's little hat | that row's own state + DOM node | what lands on the wrong bear |
| Fairy lights, doorbell, storeroom phone | **effects** | things outside React that need syncing |
| The off-switch | the **cleanup function** | no off-switch = a leak |
| "Only redo this when the sign changes" | the **dependency array** | what the sync depends on |
| Counting toys you can already see | derived state | don't use an effect — compute it |
| Sticky note in your pocket | a **ref** | changing it never triggers a re-render |
| Ticket numbers on orders | request IDs | bin answers to questions you stopped asking |
| Waiting before you sprint | **debounce** | cancel-and-restart via effect cleanup |
| "Skip this shelf if the label's the same" | **`memo`** | shallow prop comparison |
| Handing back the same paper | **`useMemo` / `useCallback`** | keeps the label comparable |
| A new label with identical words | an inline `{}` / `[]` / `() =>` | silently defeats `memo` |
| Poster on the wall | **context** | beats whispering through six people |
| Everyone looks up when it changes | context has no selectors | why it's a bad state manager |
| Recipe card | a **custom hook** | shares the steps, not the doorbell |
| Numbered drawers, same order daily | the **rules of hooks** | React indexes hooks by call order |
| "Don't open the shutters yet" | **`useLayoutEffect`** | measure and position before paint |
| "This shelf is being fixed" card | an **error boundary** | one shelf falls, the shop stays open |
| Practice setup–teardown–setup | **StrictMode** | catches lights you forgot to switch off |
| A shelf with its own notebook | an **uncontrolled** component | it knows its job better than you |
| Rubbing out a page mid-sentence | the cursor-jump bug | why `TiptapEditor` checks `isFocused` |

---

# Appendix D — What to read in the repo

In this order, once you've done the tasks:

1. `src/shared/hooks/useIsSidebarWidth.js` — 20 lines, the perfect effect.
2. `src/shared/hooks/useSync.js` — two effects, two lifetimes, a StrictMode
   guard. (Task 10)
3. `src/faces/shell/WorkspaceShell.jsx` — context, keyboard nav, subscriptions.
   (Task 11)
4. `src/features/spotlight/GlobalSpotlight.jsx:1002-1165` — the search effect.
   Races, debouncing, caching and cancellation in one place. (Tasks 4–6)
5. `src/features/spotlight/GlobalSpotlight.jsx:2763-2800` — a small component
   doing `memo` + `useCallback` + the hover/scroll ref correctly. (Tasks 7–8)
6. `src/faces/workspace/parts/editor/TiptapEditor.jsx` — wrapping an
   uncontrolled third-party widget. (Task 13)
7. `src/features/widgets/WebAppPreviews.jsx:162-260` — the hardest effect in the
   app: an interval, a RAF, four listeners, a `ResizeObserver` and two Tauri
   listeners, all torn down in one cleanup. Save it for last.
