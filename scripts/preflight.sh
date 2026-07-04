#!/usr/bin/env bash
# Preflight checks for deploying the ops-dashboard.
#
# Verifies the toolchain is present, a Kubernetes cluster is reachable, and all
# required engine environment variables are set. Exits non-zero (listing what is
# wrong) so `make deploy` fails fast before building or applying anything.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-lib.sh"

step "Preflight checks"

# --- Tooling ----------------------------------------------------------------
require_cmd docker  "Install Docker: https://docs.docker.com/get-docker/"
require_cmd kubectl "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
ok "docker and kubectl found"

# Docker daemon must be running to build images.
if ! docker info >/dev/null 2>&1; then
  die "the Docker daemon is not running or not reachable. Start Docker and retry."
fi
ok "docker daemon is running"

# --- Cluster ----------------------------------------------------------------
require_cluster
ctx="$(current_context)"
provider="$(cluster_provider)"
ok "cluster reachable (context: ${ctx}, provider: ${provider})"
if [[ "$provider" == "unknown" ]]; then
  warn "unrecognised cluster context '${ctx}'. Images will NOT be auto-loaded;"
  warn "ensure the built images are reachable by the cluster (registry or shared daemon)."
fi

# --- Environment ------------------------------------------------------------
load_env_file
if validate_required_env; then
  ok "all required engine environment variables are set"
else
  exit 1
fi

step "Preflight passed"
