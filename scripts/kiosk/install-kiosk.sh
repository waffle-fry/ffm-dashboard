#!/usr/bin/env bash
# Install (or uninstall) the kiosk LaunchAgents (Requirement 12).
#
# Generates three per-user LaunchAgents in ~/Library/LaunchAgents and loads
# them, wiring the kiosk scripts to launchd:
#
#   com.fansfund.dashboard.bootstrap  RunAtLoad  -> bootstrap.sh   (ensure cluster + deploy)
#   com.fansfund.dashboard.kiosk      RunAtLoad + KeepAlive -> start-kiosk.sh (fullscreen browser)
#   com.fansfund.dashboard.autoupdate StartInterval=300 -> auto-update.sh (pull + redeploy)
#
# Usage:
#   install-kiosk.sh              install + load the agents
#   install-kiosk.sh --uninstall  unload + remove the agents
#
# Idempotent: existing agents are unloaded before being rewritten/reloaded.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KIOSK_DIR="${REPO_ROOT}/scripts/kiosk"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/fansfund-dashboard"
INTERVAL="${KIOSK_UPDATE_INTERVAL_SECONDS:-300}"
BRANCH="${KIOSK_BRANCH:-main}"
URL="${KIOSK_URL:-http://localhost:8080}"

BOOTSTRAP_LABEL="com.fansfund.dashboard.bootstrap"
KIOSK_LABEL="com.fansfund.dashboard.kiosk"
UPDATE_LABEL="com.fansfund.dashboard.autoupdate"

labels=("$BOOTSTRAP_LABEL" "$KIOSK_LABEL" "$UPDATE_LABEL")

unload_all() {
    for label in "${labels[@]}"; do
        local plist="${AGENTS_DIR}/${label}.plist"
        launchctl unload "$plist" 2>/dev/null || true
    done
}

if [[ "${1:-}" == "--uninstall" ]]; then
    echo "==> Uninstalling kiosk LaunchAgents"
    unload_all
    for label in "${labels[@]}"; do
        rm -f "${AGENTS_DIR}/${label}.plist"
    done
    echo "  ✓ removed. (Chrome, auto-login and Docker-at-login settings are left as-is.)"
    exit 0
fi

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

# Emits a LaunchAgent plist. Args: label, out-path, then the extra <key>..</key>
# body specific to the agent (schedule keys). Program is always bash <script>.
write_plist() {
    local label="$1" out="$2" script="$3" schedule_xml="$4"
    cat >"$out" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${KIOSK_DIR}/${script}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>KIOSK_URL</key>
        <string>${URL}</string>
        <key>KIOSK_BRANCH</key>
        <string>${BRANCH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/${label}.out.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/${label}.err.log</string>
${schedule_xml}
</dict>
</plist>
PLIST
}

echo "==> Writing LaunchAgents to ${AGENTS_DIR}"
unload_all

# Bootstrap: run once at login.
write_plist "$BOOTSTRAP_LABEL" "${AGENTS_DIR}/${BOOTSTRAP_LABEL}.plist" "bootstrap.sh" \
"    <key>RunAtLoad</key>
    <true/>"

# Kiosk: run at login and relaunch whenever it exits.
write_plist "$KIOSK_LABEL" "${AGENTS_DIR}/${KIOSK_LABEL}.plist" "start-kiosk.sh" \
"    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>"

# Auto-update: run at login and every ${INTERVAL} seconds thereafter.
write_plist "$UPDATE_LABEL" "${AGENTS_DIR}/${UPDATE_LABEL}.plist" "auto-update.sh" \
"    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${INTERVAL}</integer>"

echo "==> Loading agents"
for label in "${labels[@]}"; do
    launchctl load -w "${AGENTS_DIR}/${label}.plist"
    echo "  ✓ loaded ${label}"
done

cat <<NEXT

==> Kiosk agents installed. Logs: ${LOG_DIR}/

One-time macOS steps still required (cannot be scripted safely):
  1. System Settings → Users & Groups → enable Automatic login for this user.
  2. Docker Desktop → Settings → General → "Start Docker Desktop when you sign in".
  3. System Settings → Displays / Battery → set "Turn display off" to Never
     (caffeinate also holds it awake while the kiosk runs).
  4. First run only: grant Automation permission when prompted (Terminal/launchd
     controlling "Google Chrome") so auto-update can reload the kiosk after a
     redeploy. If missed: System Settings → Privacy & Security → Automation.
  5. Ensure ${REPO_ROOT}/.env exists with the real secrets (gitignored).

Reboot to verify the full flow, or start now with:
  bash ${KIOSK_DIR}/bootstrap.sh && launchctl start ${KIOSK_LABEL}
NEXT
