#!/usr/bin/env bash
# Kiosk doctor — verify the Mac Mini is set up for boot-to-dashboard kiosk mode
# (Requirement 12). Read-only: it inspects state and reports, changing nothing.
#
# Prints a checklist of PASS / WARN / FAIL and exits non-zero if any hard
# requirement fails, so it can gate on-device verification. WARN items are
# advisory (e.g. things that only matter for auto-update, or GUI settings that
# cannot be inspected programmatically).
#
# Usage:  make kiosk-doctor      (or: bash scripts/kiosk/doctor.sh)

set -uo pipefail  # NOT -e: we want to run every check and summarise.

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/deploy-lib.sh
source "${REPO_ROOT}/scripts/deploy-lib.sh"

URL="${KIOSK_URL:-http://localhost:8080}"
CHROME="${KIOSK_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
KIND_CLUSTER="${KIND_CLUSTER:-kind}"
AGENTS=(
  com.fansfund.dashboard.bootstrap
  com.fansfund.dashboard.kiosk
  com.fansfund.dashboard.autoupdate
)

fails=0
warns=0
pass() { printf '  %s✓%s %s\n' "${_C_GRN}" "${_C_RESET}" "$*"; }
fail() { printf '  %s✗%s %s\n' "${_C_RED}" "${_C_RESET}" "$*"; fails=$(( fails + 1 )); }
note() { printf '  %s!%s %s\n' "${_C_YEL}" "${_C_RESET}" "$*"; warns=$(( warns + 1 )); }

step "Kiosk doctor"

# --- Tooling ----------------------------------------------------------------
step "Tooling"
for cmd in docker kubectl kind; do
  if command -v "$cmd" >/dev/null 2>&1; then pass "$cmd installed"; else fail "$cmd not found on PATH"; fi
done
for cmd in node npm; do
  if command -v "$cmd" >/dev/null 2>&1; then pass "$cmd installed"; else note "$cmd not found (needed only for auto-update build/test)"; fi
done
if [[ -x "$CHROME" ]]; then pass "Google Chrome found"; else fail "Google Chrome not found at $CHROME"; fi

# --- Docker -----------------------------------------------------------------
step "Docker"
if docker info >/dev/null 2>&1; then
  pass "Docker daemon is running"
else
  fail "Docker daemon not running (start Docker Desktop; set it to start at login)"
fi

# --- Cluster ----------------------------------------------------------------
step "Cluster"
if kind get clusters 2>/dev/null | grep -qx "$KIND_CLUSTER"; then
  pass "kind cluster '$KIND_CLUSTER' exists"
else
  fail "kind cluster '$KIND_CLUSTER' not found (run: make cluster-up)"
fi
if kubectl cluster-info >/dev/null 2>&1; then
  pass "cluster reachable (context: $(current_context))"
else
  fail "cluster not reachable via kubectl"
fi

# Confirm the fixed loopback port mapping is actually wired to this cluster.
if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "127.0.0.1:8080->"; then
  pass "loopback port mapping 127.0.0.1:8080 present on the kind node"
else
  note "no 127.0.0.1:8080 port mapping on the kind node — the cluster may predate k8s/kind-cluster.yaml (recreate: kind delete cluster --name $KIND_CLUSTER && make cluster-up && make deploy)"
fi

# --- Workloads --------------------------------------------------------------
step "Workloads"
for dep in dashboard-engine dashboard-ui; do
  if kubectl -n "$NAMESPACE" get deploy "$dep" >/dev/null 2>&1; then
    avail="$(kubectl -n "$NAMESPACE" get deploy "$dep" -o jsonpath='{.status.availableReplicas}' 2>/dev/null)"
    if [[ "${avail:-0}" -ge 1 ]]; then pass "$dep available (${avail} replica)"; else fail "$dep deployed but not available yet"; fi
  else
    fail "$dep not deployed (run: make deploy)"
  fi
done

# --- Dashboard URL ----------------------------------------------------------
step "Dashboard URL"
if curl -fsS -o /dev/null --max-time 5 "$URL"; then
  pass "UI responds at $URL"
else
  fail "UI not reachable at $URL"
fi
if curl -fsS -o /dev/null --max-time 5 "${URL%/}/api/metrics/summary"; then
  pass "API reachable through the UI proxy (/api)"
else
  note "API (/api) not reachable yet — engine may still be starting"
fi

# --- Config -----------------------------------------------------------------
step "Configuration"
load_env_file
if validate_required_env >/dev/null 2>&1; then
  pass "all required engine env vars present (.env)"
else
  fail "missing required engine env vars (see: make check-env)"
fi

# --- LaunchAgents -----------------------------------------------------------
step "LaunchAgents"
for label in "${AGENTS[@]}"; do
  if launchctl list 2>/dev/null | grep -q "$label"; then
    pass "$label loaded"
  else
    note "$label not loaded (run: make kiosk-install)"
  fi
done

# --- Auto-update / git ------------------------------------------------------
step "Auto-update (git)"
BRANCH="${KIOSK_BRANCH:-main}"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  current_branch="$(git symbolic-ref --short -q HEAD || echo '(detached)')"
  if [[ "$current_branch" == "$BRANCH" ]]; then
    pass "checkout is on '${BRANCH}'"
  else
    fail "checkout is on '${current_branch}', not '${BRANCH}' — auto-update will skip (run: git checkout ${BRANCH})"
  fi
  # Remote reachability with the SAME credential path fetch uses. This is the
  # most common auto-update failure: git works in your terminal (keychain/agent)
  # but not in the non-interactive launchd environment.
  if git ls-remote --exit-code origin "$BRANCH" >/dev/null 2>&1; then
    pass "origin/${BRANCH} reachable (git credentials work here)"
    local_sha="$(git rev-parse HEAD 2>/dev/null)"
    remote_sha="$(git ls-remote origin "$BRANCH" 2>/dev/null | awk '{print $1}')"
    if [[ -n "$remote_sha" && "$local_sha" == "$remote_sha" ]]; then
      pass "up to date with origin/${BRANCH} (${local_sha:0:12})"
    else
      note "behind origin/${BRANCH} (local ${local_sha:0:12} vs remote ${remote_sha:0:12}) — a healthy auto-update will deploy this"
    fi
  else
    fail "cannot reach origin/${BRANCH} via git — auto-update's fetch will fail. In launchd there is no interactive login: use an HTTPS remote with a credential in the macOS keychain (git-credential-osxkeychain) or an SSH key loaded for this user."
  fi
  # Surface the tail of the auto-update log if present.
  au_log="${HOME}/Library/Logs/fansfund-dashboard/com.fansfund.dashboard.autoupdate.out.log"
  if [[ -f "$au_log" ]]; then
    printf '    last auto-update log line: %s\n' "$(tail -n 1 "$au_log" 2>/dev/null)"
  else
    note "no auto-update log yet at $au_log (agent may not have run — check: make kiosk-install)"
  fi
else
  fail "not a git work tree"
fi

# --- macOS power settings ---------------------------------------------------
step "Power / display"
displaysleep="$(pmset -g 2>/dev/null | awk '/displaysleep/{print $2; exit}')"
if [[ -n "$displaysleep" && "$displaysleep" == "0" ]]; then
  pass "display sleep disabled (displaysleep=0)"
else
  note "display sleep is ${displaysleep:-unknown} min — set to Never so the kiosk stays on (caffeinate also holds it while running)"
fi

# GUI-only settings that cannot be inspected programmatically.
note "Cannot verify automatically: Automatic login, Docker Desktop 'start at login', and Chrome Automation permission — confirm these in System Settings (see KIOSK.md)."

# --- Summary ----------------------------------------------------------------
printf '\n'
if (( fails > 0 )); then
  error "kiosk doctor: ${fails} failure(s), ${warns} warning(s)"
  exit 1
fi
ok "kiosk doctor: all hard checks passed (${warns} warning(s) to review)"
