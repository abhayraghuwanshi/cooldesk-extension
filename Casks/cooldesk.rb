cask "cooldesk" do
  version "2.0.13"
  sha256 "5a18493e83047a5a729877de80eee9f76915959ed9d56f552821c7282530c575"

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
  # "① RUN THIS FIRST — Fix & Open CoolDesk.command" and the CI repack
  # workaround. Remove this block once the app is signed + notarized (and
  # submitted to homebrew/cask).
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
