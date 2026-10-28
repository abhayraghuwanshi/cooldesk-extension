// Run: node --test src/services/searchScoring.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchQuality, pageKey, rankUrlResults } from './searchScoring.js';

const q = (title, url, query) => matchQuality({ title, url }, query);

test('word-level match beats a mid-word substring', () => {
  assert.ok(q('GitHub', 'https://github.com', 'git') > q('Digital Ocean', 'https://do.com', 'git'));
  assert.ok(q('Digital Ocean', 'https://do.com', 'git') > 0);
});

test('short words never match mid-word', () => {
  assert.equal(q('Check your email', 'https://mail.example.com/inbox', 'ai'), 0);
  assert.ok(q('AI news', 'https://x.com', 'ai') > 0);
});

test('multi-word queries match per word, any order', () => {
  const title = 'Watch Bigg Boss S20 Episode 53 on JioHotstar';
  const url = 'https://www.hotstar.com/in/shows/bigg-boss/1971002586/watch';
  assert.ok(q(title, url, 'big boss') > 0.8);
  assert.ok(q(title, url, 'boss bigg') > 0.8);
  assert.equal(q(title, url, 'big boss xyz'), 0);
});

test('one typo is tolerated for longer words', () => {
  assert.ok(q('GitHub', 'https://github.com', 'githib') > 0);
  assert.ok(q('Watch Bigg Boss S20', 'https://hotstar.com', 'bigboss') > 0);
  assert.equal(q('GitHub', 'https://github.com', 'gat'), 0, 'too short for typo tolerance');
});

test('site name matches the domain', () => {
  assert.ok(q('Inbox', 'https://www.reddit.com/notifications', 'reddit') >= 0.8);
});

test('exact and prefix titles rank highest; initials work', () => {
  assert.equal(q('GitHub', 'https://github.com', 'github'), 1);
  assert.ok(q('Mac App Comparisons', '', 'mac app') >= 0.95);
  assert.ok(q('Visual Studio Code', '', 'vsc') > 0);
});

test('context text matches weakly', () => {
  const inWork = matchQuality({ title: 'Jira board', url: 'https://jira.example.com', context: 'Work' }, 'work');
  assert.ok(inWork > 0 && inWork < matchQuality({ title: 'Work log', url: '' }, 'work'));
});

test('pageKey collapses url variants of one page', () => {
  assert.equal(pageKey('https://www.reddit.com/r/cooldesk/'), pageKey('https://reddit.com/r/cooldesk'));
  assert.equal(
    pageKey('https://www.reddit.com/r/x/comments/1abc/slug/?screen_view_count=1#top'),
    pageKey('https://www.reddit.com/r/x/comments/1abc/other_slug/'),
  );
  assert.notEqual(pageKey('https://youtube.com/watch?v=1'), pageKey('https://youtube.com/watch?v=2'));
});

test('a tab absorbs its history row and borrows its usage', () => {
  const now = Date.UTC(2026, 9, 28);
  const out = rankUrlResults([
    { type: 'tab', id: 1, title: 'r/MacApps', url: 'https://www.reddit.com/r/macapps/' },
    { type: 'history', id: 'h', title: 'r/MacApps', url: 'https://www.reddit.com/r/macapps', visitCount: 40, lastVisitTime: now },
    { type: 'tab', id: 2, title: 'MacApps wiki', url: 'https://example.com/macapps-wiki' },
  ], 'macapps', { now });
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'tab');
  assert.equal(out[0].id, 1, 'often-visited page ranks above the unvisited one');
  assert.ok(out[0].score > out[1].score);
});

test('frequently used bookmark outranks a never-used one with the same match', () => {
  const now = Date.UTC(2026, 9, 28);
  const out = rankUrlResults([
    { type: 'bookmark', id: 'a', title: 'Docs', url: 'https://a.com/docs' },
    { type: 'bookmark', id: 'b', title: 'Docs', url: 'https://b.com/docs' },
    { type: 'history', id: 'hb', title: 'Docs', url: 'https://b.com/docs', visitCount: 20, lastVisitTime: now },
  ], 'docs', { now });
  assert.deepEqual(out.map(r => r.id), ['b', 'a']);
});

test('non-matches are dropped and scores stay within 0–100', () => {
  const out = rankUrlResults([
    { type: 'tab', id: 1, title: 'GitHub', url: 'https://github.com', visitCount: 5000, lastVisitTime: Date.now() },
    { type: 'tab', id: 2, title: 'Nothing here', url: 'https://example.com' },
  ], 'github', { boosts: { 'github.com': 30 }, boostKey: () => 'github.com' });
  assert.equal(out.length, 1);
  assert.ok(out[0].score <= 100);
});
