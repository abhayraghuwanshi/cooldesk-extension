cask "cooldesk" do
  version "1.3.0"
  sha256 "18987bd1ae6ebb657530752ac8afdf9e3a0d0972f2ef71351c673a2d2ce4038e"

  url "https://github.com/abhayraghuwanshi/cooldesk-extension/releases/download/v#{version}/CoolDesk_#{version}_aarch64.dmg",
      verified: "github.com/abhayraghuwanshi/cooldesk-extension/"
  name "CoolDesk"
  desc "AI-powered desktop workspace manager"
  homepage "https://cool-desk.com/"

  # Only an Apple Silicon (aarch64) build is published today.
  depends_on arch: :arm64
  depends_on macos: ">= :big_sur"

  app "CoolDesk.app"

  # The DMG is not yet notarized. Clear the quarantine flag on install so
  # Gatekeeper does not block first launch — this mirrors the bundled
  # "Fix Mac Install.command" and the CI repack workaround. Remove this block
  # once the app is signed + notarized (and submitted to homebrew/cask).
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/CoolDesk.app"],
                   sudo: false
  end

  uninstall quit: "com.cooldesk.desktop"

  zap trash: [
    "~/Library/Application Support/com.cooldesk.desktop",
    "~/Library/Caches/com.cooldesk.desktop",
    "~/Library/HTTPStorages/com.cooldesk.desktop",
    "~/Library/Preferences/com.cooldesk.desktop.plist",
    "~/Library/Saved Application State/com.cooldesk.desktop.savedState",
    "~/Library/WebKit/com.cooldesk.desktop",
  ]
end
