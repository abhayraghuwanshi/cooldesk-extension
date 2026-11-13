#!/usr/bin/env bash
# Prints the GitHub release body for a version: its section of docs/CHANGELOG.md
# plus install instructions. Usage: scripts/release-notes.sh 2.0.18
set -euo pipefail
V="${1#v}"
NOTES=$(awk -v v="$V" '
  /^## \[/ { if (on) exit; if (index($0, "[" v "]")) { on=1; next } }
  on' docs/CHANGELOG.md | sed -e 's/^### Added/### ✨ Added/' -e 's/^### Changed/### 💬 Changed/' \
    -e 's/^### Fixed/### 🐛 Fixed/' -e 's/^### Security/### 🔒 Security/')
if [ -z "$(echo "$NOTES" | tr -d '[:space:]')" ]; then
  echo "No section for [$V] in docs/CHANGELOG.md" >&2; exit 1
fi
cat <<MD
## What's new in $V
$NOTES

### 📦 Install
| Platform | Download |
|---|---|
| Chrome extension | [Chrome Web Store](https://chromewebstore.google.com/detail/cooldesk/ioggffobciopdddacpclplkeodllhjko) — or \`cooldesk-extension-$V.zip\` |
| Windows | \`CoolDesk_${V}_x64-setup.exe\` — or \`winget install CoolDesk.CoolDesk\` |
| macOS (Apple Silicon) | \`CoolDesk_${V}_aarch64.dmg\` — or via Homebrew (below) |
| Linux | \`CoolDesk_${V}_amd64.AppImage\` (any distro) |

macOS via Homebrew:
\`\`\`bash
brew tap abhayraghuwanshi/cooldesk https://github.com/abhayraghuwanshi/cooldesk-extension
brew install --cask cooldesk   # or: brew upgrade --cask cooldesk
\`\`\`

If macOS says the app is damaged (it isn't notarized yet):
\`\`\`bash
xattr -dr com.apple.quarantine /Applications/CoolDesk.app
\`\`\`

Full changelog: [docs/CHANGELOG.md](https://github.com/abhayraghuwanshi/cooldesk-extension/blob/master/docs/CHANGELOG.md)
MD
