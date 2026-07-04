#!/usr/bin/env bash
# Creates/updates the Kubernetes Secret the Dashboard Engine reads its config
# from, sourced from the current environment (and <repo>/.env if present).
#
# This deliberately replaces the placeholder k8s/secrets.yaml at deploy time so
# real credentials are NEVER committed to the repo. The Secret is applied
# idempotently (create-or-update) via server-side `kubectl apply`.
#
# Required variables must all be set (validated here); optional variables are
# included only when present. See scripts/deploy-lib.sh for the canonical lists.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-lib.sh"

step "Creating Secret '${SECRET_NAME}' in namespace '${NAMESPACE}'"

require_cmd kubectl "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
require_cluster
load_env_file
validate_required_env || exit 1

# Ensure the namespace exists first (idempotent).
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

# Build the --from-literal arguments. Using an array keeps values safely quoted
# (values may contain spaces, '=', URL characters, etc.). Secret values are
# passed to kubectl, not echoed, so they do not leak into logs.
args=()
for v in "${REQUIRED_VARS[@]}"; do
  args+=(--from-literal="${v}=${!v}")
done

included_optional=()
for v in "${OPTIONAL_VARS[@]}"; do
  if [[ -n "${!v:-}" ]]; then
    args+=(--from-literal="${v}=${!v}")
    included_optional+=("$v")
  fi
done

# create (dry-run) -> apply gives us idempotent create-or-update semantics.
kubectl create secret generic "${SECRET_NAME}" \
  --namespace "${NAMESPACE}" \
  "${args[@]}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

ok "Secret applied with ${#REQUIRED_VARS[@]} required key(s)"
if (( ${#included_optional[@]} > 0 )); then
  ok "included optional key(s): ${included_optional[*]}"
else
  info "no optional keys set (${OPTIONAL_VARS[*]})"
fi
