#!/usr/bin/env bash
# Loads the locally-built engine + UI images into the local Kubernetes cluster
# so the pods (imagePullPolicy: IfNotPresent) can start without a registry.
#
# Auto-detects the cluster provider from the current kubectl context and uses
# the appropriate mechanism:
#   - kind        : kind load docker-image
#   - minikube    : minikube image load
#   - k3d         : k3d image import
#   - local-daemon: no-op (docker-desktop/orbstack/rancher-desktop/colima share
#                   the host Docker daemon with the cluster)
#   - unknown     : warns and skips (images must be reachable another way)
#
# Optionally pass image refs as arguments to load a specific subset; with no
# arguments, both the engine and UI images are loaded.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-lib.sh"

images=("$@")
if (( ${#images[@]} == 0 )); then
  images=("${ENGINE_IMAGE_REF}" "${UI_IMAGE_REF}")
fi

require_cluster
provider="$(cluster_provider)"
ctx="$(current_context)"

step "Loading ${#images[@]} image(s) into cluster (provider: ${provider})"

# Verify each image exists in the local Docker daemon before attempting a load.
for img in "${images[@]}"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    die "image '$img' not found locally. Build it first (e.g. 'make build')."
  fi
done

case "$provider" in
  kind)
    require_cmd kind "Install kind: https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
    local_name="${ctx#kind-}"
    for img in "${images[@]}"; do
      info "kind load docker-image ${img} --name ${local_name}"
      kind load docker-image "$img" --name "$local_name"
      ok "loaded ${img}"
    done
    ;;
  minikube)
    require_cmd minikube "Install minikube: https://minikube.sigs.k8s.io/docs/start/"
    for img in "${images[@]}"; do
      info "minikube image load ${img}"
      minikube image load "$img"
      ok "loaded ${img}"
    done
    ;;
  k3d)
    require_cmd k3d "Install k3d: https://k3d.io/#installation"
    local_name="${ctx#k3d-}"
    for img in "${images[@]}"; do
      info "k3d image import ${img} -c ${local_name}"
      k3d image import "$img" -c "$local_name"
      ok "loaded ${img}"
    done
    ;;
  local-daemon)
    ok "cluster shares the host Docker daemon (${ctx}); no image load required"
    ;;
  unknown|*)
    warn "unrecognised cluster context '${ctx}'; skipping image load."
    warn "Ensure these images are reachable by the cluster (push to a registry it can pull):"
    for img in "${images[@]}"; do
      warn "  - ${img}"
    done
    ;;
esac
