#!/usr/bin/env node
// Post to r/cooldesk from the terminal.
//
//   node scripts/reddit-post.mjs "Title" "Some text"         text post
//   node scripts/reddit-post.mjs "Title" -f notes.md          text from a file
//   echo "text" | node scripts/reddit-post.mjs "Title"        text from stdin
//   node scripts/reddit-post.mjs "Title" --link https://...    link post
//   node scripts/reddit-post.mjs --release v2.0.16            release notes (via `gh`)
//   add --dry to any of these to preview without posting
//   add --sub other to post somewhere other than r/cooldesk
//
// Credentials live outside the repo, in ~/.config/cooldesk/reddit.env
// (or set them as environment variables):
//   REDDIT_CLIENT_ID=...      a "script" app from reddit.com/prefs/apps
//   REDDIT_CLIENT_SECRET=...
//   REDDIT_USERNAME=...       password login doesn't work with 2FA on;
//   REDDIT_PASSWORD=...       use an account without it (e.g. a mod bot)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_FILE = join(homedir(), '.config', 'cooldesk', 'reddit.env');

function fail(msg) {
    console.error(`✗ ${msg}`);
    process.exit(1);
}

// --- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, v && !v.startsWith('--') ? 2 : 1);
    return v && !v.startsWith('--') ? v : true;
};
const dry = !!flag('--dry');
const sub = flag('--sub') || 'cooldesk';
const link = flag('--link');
const file = flag('-f') || flag('--file');
const release = flag('--release');

let title;
let text = '';

if (release) {
    const tag = String(release).startsWith('v') ? String(release) : `v${release}`;
    let r;
    try {
        r = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--json', 'tagName,body,url'], { stdio: ['ignore', 'pipe', 'inherit'] }).toString());
    } catch {
        fail(`couldn't read release ${tag} with gh`);
    }
    let notes = (r.body || '').replace(/\r\n/g, '\n').trim();
    if (notes.length > 3500) notes = `${notes.slice(0, notes.lastIndexOf('\n', 3500))}\n\n…`;
    title = `CoolDesk ${r.tagName.replace(/^v/, '')} is out`;
    text = [notes, '---', `**Full release notes:** ${r.url}`, '**Download:** https://cool-desk.com/#downloads (the app also updates itself)', '', 'Questions or feedback? Reply here.'].join('\n\n');
} else {
    [title, text = ''] = args;
    if (!title) fail('give a title, e.g. node scripts/reddit-post.mjs "Title" "Text"   (or --release v2.0.16)');
    if (file) text = readFileSync(String(file), 'utf8');
    else if (!text && !link && !process.stdin.isTTY) text = readFileSync(0, 'utf8');
}

// --- preview ----------------------------------------------------------------
console.log(`\nr/${sub} · ${link ? 'link' : 'text'} post\n# ${title}\n${link ? String(link) : text}\n`);
if (dry) {
    console.log('(dry run: nothing posted)');
    process.exit(0);
}

// --- credentials ------------------------------------------------------------
if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
        const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}
const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret, REDDIT_USERNAME: user, REDDIT_PASSWORD: pass } = process.env;
if (!id || !secret || !user || !pass) fail(`missing Reddit credentials; put them in ${ENV_FILE}`);

const UA = `cli:cooldesk-reddit-post:1.0 (by /u/${user})`;

// --- post -------------------------------------------------------------------
const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ grant_type: 'password', username: user, password: pass }),
});
const token = await tokenRes.json().catch(() => ({}));
if (!token.access_token) fail(`Reddit login failed (${tokenRes.status}): ${JSON.stringify(token)}`);
const auth = { Authorization: `Bearer ${token.access_token}`, 'User-Agent': UA };

// Don't post the same title twice (e.g. re-running a release).
const recent = await (await fetch(`https://oauth.reddit.com/r/${sub}/new?limit=50`, { headers: auth })).json().catch(() => null);
if (recent?.data?.children?.some((c) => c.data.title === title)) {
    console.log(`"${title}" is already on r/${sub}; not posting again.`);
    process.exit(0);
}

const res = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sr: sub, title, api_type: 'json', resubmit: 'true', ...(link ? { kind: 'link', url: String(link) } : { kind: 'self', text }) }),
});
const out = await res.json().catch(() => ({}));
const errors = out?.json?.errors ?? [];
if (!res.ok || errors.length) fail(`post failed (${res.status}): ${JSON.stringify(errors.length ? errors : out)}`);
console.log(`✓ posted: ${out.json.data.url}`);
