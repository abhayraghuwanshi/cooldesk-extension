#!/usr/bin/env node
// Firefox build of the extension. `npm run build:firefox` first compiles the
// extension with VITE_FIREFOX=1 into dist-firefox-build/ (Chrome-only code —
// sidePanel, requestUpdateCheck — is compiled out there; the Chrome build in
// dist/ is untouched), then this script copies that to dist-firefox/,
// rewrites the manifest for Firefox, and zips it as
// cooldesk-firefox-<version>.zip for addons.mozilla.org.
// Usage: node scripts/build-firefox.mjs [build dir, default dist-firefox-build]
//
// What Firefox needs differently (from AMO's validator):
//   - background: Firefox runs background *scripts*, not a service worker.
//     The Chrome build's background is `service-worker-loader.js`, an ES
//     module that imports the real bundle, so it's listed as a module script.
//   - browser_specific_settings.gecko: the add-on id (required for MV3) and
//     data_collection_permissions (required for new add-ons).
//   - permissions: drop the Chrome-only "favicon", and "windows"/"commands",
//     which aren't permissions at all (the APIs need none).
//   - sidebar: Firefox's sidebar_action stands in for Chrome's side panel.
//   - sandbox pages: Firefox has no manifest `sandbox` key, so the custom-
//     widget sandbox (and its eval-allowing CSP) is left out; built-in
//     widgets don't use it.
//   - use_dynamic_url (Chrome-only) is removed from web_accessible_resources.
// Chrome-only APIs: sidePanel and requestUpdateCheck are compiled out by
// VITE_FIREFOX; the _favicon service is one of several icon sources and just
// misses in Firefox.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, process.argv[2] || 'dist-firefox-build');
const out = join(root, 'dist-firefox');

// The id ties the listing to every future version — never change it once
// the add-on is published.
const GECKO_ID = 'cooldesk@cool-desk.com';
// 140: data_collection_permissions (and tabGroups) are supported from here;
// it's also the current ESR.
const MIN_FIREFOX = '140.0';
// Android got data_collection_permissions later than desktop.
const MIN_FIREFOX_ANDROID = '142.0';

if (!existsSync(join(src, 'manifest.json'))) {
  console.error(`${src}/manifest.json not found — run \`npm run build:firefox\`.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
rmSync(join(out, '.vite'), { recursive: true, force: true });

const manifestPath = join(out, 'manifest.json');
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Background: module script instead of a service worker.
const bg = m.background?.service_worker;
if (!bg) throw new Error('No background.service_worker in the Chrome build');
m.background = { scripts: [bg], type: 'module' };

m.browser_specific_settings = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: MIN_FIREFOX,
    // CoolDesk keeps everything on the device (and the local desktop app);
    // it sends no personal data anywhere.
    data_collection_permissions: { required: ['none'] },
  },
  // Firefox for Android reads data_collection_permissions only from 142.
  gecko_android: { strict_min_version: MIN_FIREFOX_ANDROID },
};

const DROP_PERMISSIONS = new Set(['favicon', 'windows', 'commands']);
m.permissions = (m.permissions || []).filter(p => !DROP_PERMISSIONS.has(p));

// Firefox's sidebar shows the same page Chrome's side panel does.
m.sidebar_action = {
  default_panel: 'pages/extension.html',
  default_title: m.action?.default_title || m.name,
  default_icon: m.action?.default_icon || m.icons,
};

// No sandbox pages in Firefox: drop the key, its CSP and the page itself.
delete m.sandbox;
if (m.content_security_policy) delete m.content_security_policy.sandbox;
rmSync(join(out, 'pages', 'widget-sandbox.html'), { force: true });

for (const entry of m.web_accessible_resources || []) {
  delete entry.use_dynamic_url;
  // The manifest's "dist/*" resource pattern makes the build copy the project's
  // dist/ (the Chrome build) into this one — stale files nothing loads.
  entry.resources = entry.resources.filter(r => !r.startsWith('dist/'));
}
rmSync(join(out, 'dist'), { recursive: true, force: true });

writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);

const zipName = `cooldesk-firefox-${m.version}.zip`;
const zipPath = join(root, zipName);
rmSync(zipPath, { force: true });
// Zip the folder's *contents* (manifest.json at the zip root, as AMO wants).
execFileSync('zip', ['-qr', zipPath, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: out, stdio: 'inherit' });

console.log(`Firefox build: dist-firefox/ → ${zipName}`);
