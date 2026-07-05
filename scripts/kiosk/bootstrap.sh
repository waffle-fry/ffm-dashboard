#!/usr/bin/env bash
# Kiosk boot bootstrap (Requirement 12.2).
#
# Run once at login (via the bootstrap LaunchAgent) BEFORE the kiosk browser
# comes up. It:
#   1. waits for the Docker daemon to be ready (Docker Desktop can lag at boot);
#   2. ensures the kind cluster exists (make cluster-up — a no-op if present);
#   3. deploys the engine + UI when they are not already running.
#
# Kubernetes keeps the single-replica workloads running across restarts, so on a
# normal reboot (cluster already present + deployed) this is fast and only the
# Docker wait matters. A full `make deploy` (build + load + apply) runs only on
# first boot or after the cluster was recreated.
#
# Safe to run repeatedly. Logs to stdout/stderr (captured by launchd).

set -euo pipefail

# launchd starts agents with a minimal PATH; add the usual tool locations so
# docker/kubectl/kind/node/npm resolve.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/deploy-lib.sh
source "${REPO_ROOT}/scripts/deploy-lib.sh"

# How long to wait for Docker to come up at boot (seconds).
DOCKER_WAIT_SECONDS="${DOCKER_WAIT_SECONDS:-180}"

step "Kiosk bootstrap"

# --- 1. Wait for Docker -----------------------------------------------------
require_cmd docker "Install Docker Desktop and set it to start at login."
info "Waiting for the Docker daemon (up to ${DOCKER_WAIT_SECONDS}s)…"
waited=0
until docker info >/dev/null 2>&1; do
  if (( waited >= DOCKER_WAIT_SECONDS )); then
    die "Docker daemon did not become ready within ${DOCKER_WAIT_SECONDS}s."
  fi
  sleep 3
  waited=$(( waited + 3 ))
done
ok "Docker daemon is ready"

# --- 2. Ensure the cluster --------------------------------------------------
make cluster-up

# --- 3. Deploy if not already running ---------------------------------------
if kubectl -n "${NAMESPACE}" get deploy dashboard-engine dashboard-ui >/dev/null 2>&1; then
  ok "workloads already present in '${NAMESPACE}' — skipping build/deploy"
  # Make sure they are actually scheduled (a freshly-started cluster may still
  # be pulling); wait briefly but do not fail boot if it is slow.
  kubectl -n "${NAMESPACE}" rollout status deploy/dashboard-ui --timeout=120s || \
    warn "dashboard-ui not ready yet; the kiosk launcher will keep polling."
else
  step "Workloads not found — running full deploy"
  make deploy
fi

step "Bootstrap complete"
