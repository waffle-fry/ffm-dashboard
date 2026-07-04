#!/usr/bin/env bash
# Shared helpers for the ops-dashboard deployment scripts.
#
# This file is meant to be *sourced*, not executed. It provides:
#   - coloured logging helpers (log/info/warn/error/die/ok/step);
#   - the canonical list of engine configuration variables (required/optional);
#   - .env loading + required-variable validation;
#   - deployment configuration defaults (namespace, image names, ports);
#   - a small set of tool/cluster detection helpers.
#
# Every consumer script does its own `set -euo pipefail`; this library avoids
# changing shell options so it stays safe to source.

# --- Deployment configuration (overridable via environment) ----------------
# These mirror the values baked into the k8s manifests (k8s/*.yaml) and the
# Dockerfiles. Override any of them by exporting the variable before running
# make/scripts, e.g. `IMAGE_TAG=v1.2.3 make deploy`.
NAMESPACE="${NAMESPACE:-fansfund-ops}"
ENGINE_IMAGE="${ENGINE_IMAGE:-fansfund-ops/dashboard-engine}"
UI_IMAGE="${UI_IMAGE:-fansfund-ops/dashboard-ui}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SECRET_NAME="${SECRET_NAME:-dashboard-engine-secrets}"
NODE_PORT="${NODE_PORT:-30080}"

# Fully-qualified image references.
ENGINE_IMAGE_REF="${ENGINE_IMAGE}:${IMAGE_TAG}"
UI_IMAGE_REF="${UI_IMAGE}:${IMAGE_TAG}"

# Repo root: this library lives in <repo>/scripts, so the root is one level up.
# Resolve it robustly regardless of the caller's working directory.
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${_LIB_DIR}/.." && pwd)"
K8S_DIR="${REPO_ROOT}/k8s"

# --- Engine configuration variables -----------------------------------------
# The engine reads all of these from the environment (see
# packages/engine/src/clients/source-clients.ts). REQUIRED_VARS must all be
# present or the engine degrades every data source to an error state; the
# deploy fails fast when any are missing. OPTIONAL_VARS are injected only when
# set.
REQUIRED_VARS=(
  STRIPE_API_KEY
  MONGODB_URI
  AWS_REGION
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  GRAFANA_URL
  GRAFANA_API_KEY
  GRAFANA_DATASOURCE_UID
  GRAFANA_SERVICES
)

OPTIONAL_VARS=(
  MONGODB_DB
  S3_DISPUTE_DOCS_BUCKET
  AWS_ROLE_ARN
  AWS_ROLE_SESSION_NAME
  AWS_ROLE_EXTERNAL_ID
  REFRESH_INTERVAL_MINUTES
  SOURCE_TIMEOUT_MS
)

# --- Colours / logging -------------------------------------------------------
# Disable colour when not a TTY or when NO_COLOR is set.
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  _C_RESET=$'\033[0m'; _C_RED=$'\033[31m'; _C_GRN=$'\033[32m'
  _C_YEL=$'\033[33m'; _C_BLU=$'\033[34m'; _C_BOLD=$'\033[1m'
else
  _C_RESET=""; _C_RED=""; _C_GRN=""; _C_YEL=""; _C_BLU=""; _C_BOLD=""
fi

step()  { printf '%s\n' "${_C_BOLD}${_C_BLU}==>${_C_RESET} ${_C_BOLD}$*${_C_RESET}"; }
info()  { printf '%s\n' "    $*"; }
ok()    { printf '%s\n' "${_C_GRN}  ✓${_C_RESET} $*"; }
warn()  { printf '%s\n' "${_C_YEL}  !${_C_RESET} $*" >&2; }
error() { printf '%s\n' "${_C_RED}  ✗ ERROR:${_C_RESET} $*" >&2; }
die()   { error "$*"; exit 1; }

# --- Tool detection ----------------------------------------------------------
# require_cmd <command> [install hint]
require_cmd() {
  local cmd="$1"; local hint="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if [[ -n "$hint" ]]; then
      die "required command '$cmd' not found. $hint"
    fi
    die "required command '$cmd' not found on PATH."
  fi
}

# --- .env loading ------------------------------------------------------------
# Loads KEY=VALUE pairs from <repo>/.env (if present) into the environment,
# without clobbering variables already set in the shell (real env wins over the
# file). Values may be quoted; lines beginning with # and blank lines are
# ignored. Safe under `set -u`.
load_env_file() {
  local env_file="${ENV_FILE:-${REPO_ROOT}/.env}"
  [[ -f "$env_file" ]] || return 0
  info "Loading environment from ${env_file}"
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Strip leading/trailing whitespace.
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Support an optional leading `export `.
    line="${line#export }"
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    # Trim whitespace around the key.
    key="${key//[[:space:]]/}"
    [[ -z "$key" ]] && continue
    # Trim surrounding whitespace from the (as-yet unquoted) value so that
    # `KEY = value` parses like `KEY=value`. Whitespace inside quotes is
    # preserved because the quote stripping below runs after this trim.
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    # Strip one layer of surrounding single or double quotes from the value.
    if [[ "$val" == \"*\" && "$val" == *\" ]]; then
      val="${val#\"}"; val="${val%\"}"
    elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
      val="${val#\'}"; val="${val%\'}"
    fi
    # Real environment takes precedence over the file.
    if [[ -z "${!key:-}" ]]; then
      export "${key}=${val}"
    fi
  done < "$env_file"
}

# --- Required-variable validation -------------------------------------------
# Exits non-zero listing every missing required variable. Call load_env_file
# first if you want .env values considered.
validate_required_env() {
  local missing=()
  local v
  for v in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!v:-}" ]]; then
      missing+=("$v")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    error "Missing required environment variable(s):"
    for v in "${missing[@]}"; do
      printf '        - %s\n' "$v" >&2
    done
    printf '\n' >&2
    info "Set them in your shell or in ${REPO_ROOT}/.env (see .env.example)." >&2
    return 1
  fi
  return 0
}

# --- Cluster detection -------------------------------------------------------
# Prints the current kubectl context, or empty string on failure.
current_context() {
  kubectl config current-context 2>/dev/null || true
}

# Verifies the cluster is reachable; dies with guidance otherwise.
require_cluster() {
  require_cmd kubectl "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
  if ! kubectl cluster-info >/dev/null 2>&1; then
    die "no reachable Kubernetes cluster. Check your kubeconfig / current context ('$(current_context)')."
  fi
}

# Classifies the current context into a known local-cluster provider so images
# can be loaded appropriately. Echoes one of:
#   kind | minikube | k3d | local-daemon | unknown
cluster_provider() {
  local ctx; ctx="$(current_context)"
  case "$ctx" in
    kind-*)                       echo "kind" ;;
    minikube)                     echo "minikube" ;;
    k3d-*)                        echo "k3d" ;;
    docker-desktop|orbstack|rancher-desktop|colima) echo "local-daemon" ;;
    *)                            echo "unknown" ;;
  esac
}
