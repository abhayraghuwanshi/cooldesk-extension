#!/bin/bash
# Repacks the Tauri-built DMG to include a "RUN THIS FIRST" fix script for
# users who hit the "app is corrupted" Gatekeeper error on unsigned builds,
# and arranges the DMG's Finder window so that script is impossible to miss.
#
# The window-arrangement step drives Finder via AppleScript, which needs a
# logged-in GUI session (present on GitHub's macos-latest runners, and on a
# normal dev Mac). If it fails for any reason, we fall back to an unarranged
# but still fully functional DMG rather than failing the whole release.
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
FIX_NAME="① RUN THIS FIRST — Fix & Open CoolDesk.command"
VOLNAME="CoolDesk"
echo "==> Repacking $DMG_NAME"

# Mount original DMG
hdiutil attach "$DMG_PATH" -mountpoint /Volumes/CoolDeskSrc -nobrowse -readonly \
  || { echo "ERROR: hdiutil attach (source) failed with exit $?"; exit 1; }

# Copy app out
cp -r /Volumes/CoolDeskSrc/*.app "$STAGING/" \
  || { echo "ERROR: cp of .app out of source DMG failed with exit $?"; exit 1; }
APP_NAME=$(ls "$STAGING" | grep '\.app$' | head -1)
if [ -z "$APP_NAME" ]; then
  echo "ERROR: no .app found in $STAGING after copy"
  ls -la "$STAGING"
  exit 1
fi

hdiutil detach /Volumes/CoolDeskSrc \
  || { echo "ERROR: hdiutil detach (source) failed with exit $?"; exit 1; }

# Applications symlink so drag-to-install still works
ln -s /Applications "$STAGING/Applications"

# Write the fix script. Numbered + shouted so it's the first thing a user
# sees and understands even if they never read a README.
cat > "$STAGING/$FIX_NAME" << FIXSCRIPT
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
chmod +x "$STAGING/$FIX_NAME"

cat > "$STAGING/README.txt" << README
CoolDesk isn't notarized by Apple yet, so macOS Gatekeeper will call it
"damaged" the first time you try to open it. This is expected — the app
is not actually damaged.

To fix it:
  1. Drag CoolDesk.app into the Applications folder (right, in this window).
  2. Double-click "$FIX_NAME".
  3. CoolDesk will open normally from then on.
README

# Build a writable DMG so we can arrange the Finder window before shipping.
RW_DMG="/tmp/${DMG_NAME%.dmg}-rw.dmg"
rm -f "$RW_DMG"
hdiutil create -volname "$VOLNAME" -srcfolder "$STAGING" -ov -format UDRW "$RW_DMG" \
  || { echo "ERROR: hdiutil create (writable DMG) failed with exit $?"; exit 1; }

ARRANGED=0
if hdiutil attach "$RW_DMG" -quiet; then
  if osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLNAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {400, 100, 1040, 460}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 96
    set position of item "$FIX_NAME" of container window to {130, 140}
    set position of item "$APP_NAME" of container window to {380, 140}
    set position of item "Applications" of container window to {520, 140}
    set position of item "README.txt" of container window to {130, 280}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
APPLESCRIPT
  then
    ARRANGED=1
  else
    echo "WARN: Finder window arrangement failed — shipping DMG with default layout"
  fi
  sync
  hdiutil detach "/Volumes/$VOLNAME" -quiet 2>/dev/null || hdiutil detach "/Volumes/$VOLNAME" -force -quiet
else
  echo "WARN: could not mount writable DMG for arrangement — shipping DMG with default layout"
fi
[ "$ARRANGED" = "1" ] && echo "==> Finder window arranged"

# Convert to compressed, read-only for distribution.
NEW_DMG="/tmp/$DMG_NAME"
rm -f "$NEW_DMG"
hdiutil convert "$RW_DMG" -format UDZO -o "$NEW_DMG" \
  || { echo "ERROR: hdiutil convert (compress DMG) failed with exit $?"; exit 1; }

# Replace original
cp "$NEW_DMG" "$DMG_PATH" \
  || { echo "ERROR: cp of final DMG over $DMG_PATH failed with exit $?"; exit 1; }
rm -rf "$STAGING" "$RW_DMG" "$NEW_DMG"

echo "==> Done: $DMG_PATH now includes \"$FIX_NAME\""
