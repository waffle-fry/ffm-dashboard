#!/usr/bin/env bash
# Kiosk display launcher (Requirements 12.3, 12.4).
#
# Run by the kiosk LaunchAgent (RunAtLoad + KeepAlive). It waits until the
# dashboard URL responds, then launches Google Chrome fullscreen in kiosk/app
# mode showing only the dashboard, and holds a `caffeinate` handle so the
# display/system never sleeps while the kiosk is up.
#
# Because the LaunchAgent uses KeepAlive, if Chrome is quit or crashes this
# script exits and launchd relaunches it — which re-waits for health and
# reopens the dashboard.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# The fixed loopback URL from the kind port mapping (Requirement 12.1).
URL="${KIOSK_URL:-http://localhost:8080}"
CHROME="${KIOSK_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
# Dedicated Chrome profile so there is no session-restore bubble, no sync, and
# no unrelated tabs — the kiosk is isolated from any interactive Chrome use.
PROFILE_DIR="${KIOSK_CHROME_PROFILE:-${HOME}/.fansfund-kiosk-chrome}"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at: $CHROME" >&2
  echo "Install Chrome or set KIOSK_CHROME to its binary path." >&2
  exit 1
fi

# --- Wait for the dashboard to be serving -----------------------------------
echo "Waiting for dashboard at ${URL}…"
until curl -fsS -o /dev/null "$URL"; do
  sleep 3
done
echo "Dashboard is up; launching kiosk."

# --- Keep the display awake for as long as the kiosk runs -------------------
# -d display, -i idle, -m disk, -s system; runs until we kill it on exit.
caffeinate -dimsu &
CAFFEINATE_PID=$!
cleanup() {
  kill "$CAFFEINATE_PID" 2>/dev/null || true
}
trap cleanup EXIT

# --- Launch Chrome in the foreground ----------------------------------------
# --kiosk = fullscreen, no chrome UI; --app = single app window for the URL.
# The remaining flags suppress first-run/restore/update nags. When Chrome exits
# this script returns and (via KeepAlive) launchd relaunches it.
"$CHROME" \
  --kiosk \
  --app="$URL" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --disable-features=Translate \
  --disable-background-timer-throttling \
  --overscroll-history-navigation=0 \
  --password-store=basic

# Chrome exited: clean up caffeinate (trap) and let launchd relaunch us.
echo "Chrome exited; launchd will relaunch the kiosk."
