#!/usr/bin/env bash
# Kiosk auto-update (Requirements 12.5–12.10).
#
# Run periodically by the auto-update LaunchAgent (StartInterval, default 300s).
# It keeps the kiosk on the latest commit of the tracked branch:
#
#   1. single-instance lock (no concurrent runs)                        (12.9)
#   2. git fetch origin <branch>                                        (12.5)
#   3. deploy ONLY when the remote is strictly ahead AND the local HEAD
#      is an ancestor of it (a genuine fast-forward)                    (12.6, 12.7)
#   4. git pull --ff-only; npm ci (if lockfile changed); build; test    (12.6)
#   5. make deploy only when build + tests pass                         (12.6, 12.7)
#   6. reload the kiosk browser so the new UI shows                     (12.8)
#
# It never modifies gitignored/untracked files such as .env (12.10): it only
# fast-forwards tracked history and never stashes or checks out over local
# changes.
#
# Usage:
#   auto-update.sh            run a full check + (conditional) redeploy
#   auto-update.sh --check    print the deploy decision and exit (no side effects
#                             beyond a read-only `git fetch`)

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BRANCH="${KIOSK_BRANCH:-main}"
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

log() { printf '%s [auto-update] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

# --- Single-instance lock (12.9) --------------------------------------------
# macOS has no `flock`; use an atomic mkdir as the lock. A stale lock from a
# crashed run older than 1h is reclaimed so the updater can never wedge itself.
LOCK_DIR="${TMPDIR:-/tmp}/fansfund-dashboard-autoupdate.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -d "$LOCK_DIR" ]] && [[ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +60 2>/dev/null)" ]]; then
    log "reclaiming stale lock"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    mkdir "$LOCK_DIR" 2>/dev/null || { log "another run holds the lock; skipping"; exit 0; }
  else
    log "another run in progress; skipping"
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# --- Fetch + fast-forward decision (12.5, 12.6) -----------------------------
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "not a git work tree; skipping"
  exit 0
fi

if ! git fetch --quiet origin "$BRANCH" 2>/dev/null; then
  log "git fetch failed (offline?); keeping current version"
  exit 0
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/${BRANCH}")"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  log "up to date at ${LOCAL:0:12}"
  exit 0
fi

# Only deploy on a real fast-forward: local HEAD must be an ancestor of remote.
# This rejects diverged history and force-pushes (12.7).
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  log "origin/${BRANCH} is not a fast-forward of local HEAD; skipping (manual reconcile needed)"
  exit 0
fi

if (( CHECK_ONLY )); then
  log "WOULD DEPLOY: ${LOCAL:0:12} -> ${REMOTE:0:12} (fast-forward)"
  exit 0
fi

log "new commits on ${BRANCH}: ${LOCAL:0:12} -> ${REMOTE:0:12}; updating"

# --- Pull, verify, deploy (12.6, 12.7) --------------------------------------
if ! git pull --ff-only origin "$BRANCH"; then
  log "git pull --ff-only failed; keeping current version"
  exit 1
fi

# Reinstall deps only when the lockfile actually changed across the update.
if ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json; then
  log "package-lock.json changed; running npm ci"
  if ! npm ci; then log "npm ci failed; NOT redeploying"; exit 1; fi
fi

if ! npm run build; then
  log "build failed; NOT redeploying (running version retained)"
  exit 1
fi

# Tests run through the hardened wrapper (npm test -> scripts/run-tests.mjs).
if ! npm test; then
  log "tests failed; NOT redeploying (running version retained)"
  exit 1
fi

if ! make deploy; then
  log "make deploy failed"
  exit 1
fi

log "deployed ${REMOTE:0:12}"

# --- Reload the kiosk browser so the new UI is shown (12.8) -----------------
# Best-effort: reloads every Chrome tab (the kiosk app window). Never fails the
# run if Chrome is not running or Automation permission is absent.
if pgrep -x "Google Chrome" >/dev/null 2>&1; then
  osascript <<'APPLESCRIPT' 2>/dev/null || log "could not reload Chrome (grant Automation permission?)"
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      tell t to reload
    end repeat
  end repeat
end tell
APPLESCRIPT
  log "kiosk browser reloaded"
fi

log "update complete"
