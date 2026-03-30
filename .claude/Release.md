# Build & Release

## Local Build

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/`

---

## Release a New Version

1. Bump version in `src-tauri/tauri.conf.json`:
   ```json
   "version": "1.0.1"
   ```

2. Commit, tag, and push:
   ```bash
   git add src-tauri/tauri.conf.json
   git commit -m "chore: bump version to v1.0.1"
   git tag v1.0.1
   git push origin master --tags
   ```

3. GitHub Actions builds Windows + macOS and creates a **draft release** automatically.

4. Go to [GitHub Releases](https://github.com/abhayraghuwanshi/cooldesk-extension/releases), review, and **publish** the draft.

Users with the app installed will receive the update on next launch.

---

## Fix a Bad Tag

```bash
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
# re-tag and push again
git tag v1.0.1
git push origin v1.0.1
```

---

## GitHub Secrets Required

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/cooldesk.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password set during key generation (blank if none) |

Set at: **repo → Settings → Secrets → Actions**
