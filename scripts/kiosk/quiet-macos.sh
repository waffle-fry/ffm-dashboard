#!/usr/bin/env bash
# Quiet the Mac Mini for kiosk use — suppress the interruptions that cover the
# dashboard (the macOS software-update password prompt, the screen saver, sleep).
#
# BEST EFFORT: recent macOS enforces some of these only via MDM / Configuration
# Profiles, and several settings (Do Not Disturb, "require password after
# sleep") are GUI-only. This script applies the reliably-scriptable ones and
# prints the manual steps for the rest. Re-run any time; it is idempotent.
#
# Requires sudo for the system-wide software-update / power settings — you will
# be prompted. Nothing here is destructive; every change is reversible in
# System Settings.
#
# Usage:  make kiosk-quiet   (or: bash scripts/kiosk/quiet-macos.sh)

set -uo pipefail

info() { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }

step "Disabling automatic macOS updates (stops the update password prompt)"
# System domain — needs sudo. Keeps Security Responses on (harmless, no prompt).
if sudo -v 2>/dev/null; then
  sudo softwareupdate --schedule off || true
  sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled -bool false || true
  sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticDownload -bool false || true
  sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates -bool false || true
  sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallAppUpdates -bool false || true
  sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false || true
  info "automatic download/install of macOS + App Store updates disabled"
else
  info "skipped (no sudo): run this script again and enter your password to disable updates"
fi

step "Disabling the screen saver"
defaults -currentHost write com.apple.screensaver idleTime -int 0 || true
info "screen saver idle time set to 0 (never)"

step "Disabling display + system sleep"
if sudo -v 2>/dev/null; then
  sudo pmset -a displaysleep 0 sleep 0 || true
  info "displaysleep and sleep set to 0 (the kiosk also holds caffeinate while running)"
else
  info "skipped (no sudo): run 'sudo pmset -a displaysleep 0 sleep 0'"
fi

cat <<'MANUAL'

==> Manual steps (GUI-only, cannot be scripted reliably)
  1. Notifications: menu-bar date/time → Focus → Do Not Disturb ON, and add a
     Focus schedule that is on 24/7 (Focus settings). Fullscreen apps do NOT
     auto-silence notifications, so this is required.
  2. Lock screen: System Settings → Lock Screen →
       - "Start Screen Saver when inactive" = Never
       - "Require password after screen saver begins or display is off" = Never
  3. Verify Software Update: System Settings → General → Software Update →
     Automatic Updates (ⓘ) → confirm "Install macOS updates" is OFF.
  4. Editor auto-update prompt ("... wants to install a helper tool"): that is an
     editor updater (VS Code / Kiro), NOT macOS. Preferably do not run the editor
     on the kiosk — remove it from System Settings → General → Login Items and
     quit it. If it must run, set "update.mode": "none" in its User Settings
     (VS Code: ~/Library/Application Support/Code/User/settings.json).

==> Most reliable for a locked-down kiosk
  Enforce the above with a Configuration Profile (.mobileconfig) so they survive
  reboots/OS updates. See KIOSK.md → "Silence the device". Ask if you want a
  ready-made profile generated for this device.
MANUAL

step "Done (re-run after major OS updates, which can re-enable some settings)"
