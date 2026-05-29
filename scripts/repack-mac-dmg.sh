#!/bin/bash
# Repacks the Tauri-built DMG to include a "Fix Mac Install.command" workaround
# for users who get the "app is corrupted" Gatekeeper error on unsigned builds.
set -e

TARGET="${1:-aarch64-apple-darwin}"
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle/dmg"
DMG_PATH=$(find "$BUNDLE_DIR" -name "*.dmg" | head -1)

if [ -z "$DMG_PATH" ]; then
  echo "ERROR: No .dmg found in $BUNDLE_DIR"
  exit 1
fi

DMG_NAME=$(basename "$DMG_PATH")
STAGING=$(mktemp -d)
echo "==> Repacking $DMG_NAME"

# Mount original DMG
hdiutil attach "$DMG_PATH" -mountpoint /Volumes/CoolDeskSrc -nobrowse -readonly -quiet

# Copy app out
cp -r /Volumes/CoolDeskSrc/*.app "$STAGING/" 2>/dev/null || true
APP_NAME=$(ls "$STAGING" | grep '\.app$' | head -1)

# Applications symlink so drag-to-install still works
ln -s /Applications "$STAGING/Applications"

# Write the fix script
cat > "$STAGING/Fix Mac Install.command" << FIXSCRIPT
#!/bin/bash
APP="/Applications/$APP_NAME"
if [ ! -d "\$APP" ]; then
  echo ""
  echo "  CoolDesk not found in /Applications."
  echo "  Please drag CoolDesk to the Applications folder first, then run this script again."
  echo ""
  read -rp "  Press Enter to exit..."
  exit 1
fi
echo ""
echo "  Fixing CoolDesk — removing macOS quarantine flag..."
xattr -cr "\$APP"
echo "  Done! Launching CoolDesk..."
echo ""
open "\$APP"
FIXSCRIPT
chmod +x "$STAGING/Fix Mac Install.command"

hdiutil detach /Volumes/CoolDeskSrc -quiet

# Build new DMG
NEW_DMG="/tmp/$DMG_NAME"
hdiutil create \
  -volname "CoolDesk" \
  -srcfolder "$STAGING" \
  -ov -format UDZO \
  "$NEW_DMG" > /dev/null

# Replace original
cp "$NEW_DMG" "$DMG_PATH"
rm -rf "$STAGING" "$NEW_DMG"

echo "==> Done: $DMG_PATH now includes Fix Mac Install.command"
