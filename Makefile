# ============================================================================
# FansFund Ops Dashboard — build & deploy
#
# One command to get it running on your local Kubernetes cluster:
#
#     make deploy
#
# That runs preflight checks (tooling, cluster, required env vars), builds both
# container images, loads them into the local cluster, creates the config
# Secret from your environment / .env, applies the manifests, and waits for the
# rollout. Run `make help` for the full list of targets, including fast
# per-component targets (deploy-engine / deploy-ui) and operational helpers.
#
# Configuration (override on the command line or via the environment):
#   NAMESPACE     k8s namespace          (default: fansfund-ops)
#   IMAGE_TAG     image tag              (default: latest)
#   ENGINE_IMAGE  engine image name      (default: fansfund-ops/dashboard-engine)
#   UI_IMAGE      ui image name          (default: fansfund-ops/dashboard-ui)
#   LOCAL_PORT    port-forward host port (default: 8080)
#
# Required engine env vars (see .env.example): STRIPE_API_KEY, MONGODB_URI,
# AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, GRAFANA_URL,
# GRAFANA_API_KEY, GRAFANA_DATASOURCE_UID, GRAFANA_SERVICES.
# ============================================================================

SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# --- Configuration (overridable) --------------------------------------------
NAMESPACE    ?= fansfund-ops
IMAGE_TAG    ?= latest
ENGINE_IMAGE ?= fansfund-ops/dashboard-engine
UI_IMAGE     ?= fansfund-ops/dashboard-ui
LOCAL_PORT   ?= 8080
KIND_CLUSTER ?= kind

ENGINE_REF := $(ENGINE_IMAGE):$(IMAGE_TAG)
UI_REF     := $(UI_IMAGE):$(IMAGE_TAG)

# Export so the helper scripts in scripts/ pick up the same configuration.
export NAMESPACE IMAGE_TAG ENGINE_IMAGE UI_IMAGE

SCRIPTS := ./scripts

.PHONY: help preflight check-env install test build-app \
        build build-engine build-ui \
        load load-engine load-ui \
        namespace secret apply-engine apply-ui \
        deploy deploy-engine deploy-ui rollout \
        status urls logs-engine logs-ui restart-engine restart-ui \
        port-forward undeploy clean \
        cluster-up kiosk-install kiosk-uninstall kiosk-doctor kiosk-quiet

# ----------------------------------------------------------------------------
help: ## Show this help
	@printf '\nFansFund Ops Dashboard — make targets\n\n'
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@printf '\nQuick start:  \033[1mmake deploy\033[0m   (then: \033[1mmake port-forward\033[0m)\n\n'

# --- Verification ------------------------------------------------------------
preflight: ## Check tooling, cluster reachability, and required env vars
	@$(SCRIPTS)/preflight.sh

check-env: ## Validate required engine env vars only (no cluster needed)
	@source $(SCRIPTS)/deploy-lib.sh && load_env_file && \
	  if validate_required_env; then echo "  ✓ all required env vars set"; else exit 1; fi

# --- Local build / test ------------------------------------------------------
install: ## Install workspace dependencies (npm ci)
	@npm ci

test: ## Run the full test suite (hardened wrapper)
	@npm test

build-app: ## Type-check / build all workspaces (no containers)
	@npm run build

# --- Container images --------------------------------------------------------
build: build-engine build-ui ## Build both container images

build-engine: ## Build the engine image
	@echo "==> Building $(ENGINE_REF)"
	@docker build -f packages/engine/Dockerfile -t $(ENGINE_REF) .

build-ui: ## Build the UI image
	@echo "==> Building $(UI_REF)"
	@docker build -f packages/ui/Dockerfile -t $(UI_REF) .

# --- Load images into the local cluster --------------------------------------
load: ## Load both images into the local cluster (auto-detects kind/minikube/k3d)
	@$(SCRIPTS)/load-images.sh $(ENGINE_REF) $(UI_REF)

load-engine: ## Load only the engine image into the cluster
	@$(SCRIPTS)/load-images.sh $(ENGINE_REF)

load-ui: ## Load only the UI image into the cluster
	@$(SCRIPTS)/load-images.sh $(UI_REF)

# --- Kubernetes resources ----------------------------------------------------
namespace: ## Create the namespace (idempotent)
	@kubectl apply -f k8s/namespace.yaml

secret: ## Create/update the engine config Secret from env / .env
	@$(SCRIPTS)/create-secret.sh

apply-engine: ## Apply the engine Deployment + Service (and restart to pick up :latest)
	@kubectl apply -f k8s/engine-deployment.yaml
	@kubectl rollout restart deploy/dashboard-engine -n $(NAMESPACE)

apply-ui: ## Apply the UI Deployment + Service (and restart to pick up :latest)
	@kubectl apply -f k8s/ui-deployment.yaml
	@kubectl rollout restart deploy/dashboard-ui -n $(NAMESPACE)

# --- Orchestrated deploys ----------------------------------------------------
deploy: preflight build load namespace secret apply-engine apply-ui rollout urls ## Full deploy: build + load + secret + apply + wait
	@echo "==> Deploy complete."

deploy-engine: preflight build-engine load-engine namespace secret apply-engine ## Rebuild & redeploy only the engine
	@kubectl rollout status deploy/dashboard-engine -n $(NAMESPACE) --timeout=180s
	@echo "==> Engine redeployed."

deploy-ui: build-ui load-ui namespace apply-ui ## Rebuild & redeploy only the UI
	@kubectl rollout status deploy/dashboard-ui -n $(NAMESPACE) --timeout=180s
	@echo "==> UI redeployed."

rollout: ## Wait for both deployments to become available
	@echo "==> Waiting for rollouts"
	@kubectl rollout status deploy/dashboard-engine -n $(NAMESPACE) --timeout=180s
	@kubectl rollout status deploy/dashboard-ui -n $(NAMESPACE) --timeout=180s

# --- Operations --------------------------------------------------------------
status: ## Show deployment / pod / service status
	@kubectl get deploy,pod,svc -n $(NAMESPACE) -o wide

urls: ## Print how to reach the dashboard
	@echo ""
	@echo "Dashboard is deployed to namespace '$(NAMESPACE)'."
	@echo "Reach the UI with a port-forward (works on every cluster type):"
	@echo ""
	@echo "    make port-forward         # then open http://localhost:$(LOCAL_PORT)"
	@echo ""
	@echo "Or via the NodePort service 'dashboard-ui' on node port 30080"
	@echo "(e.g. minikube: 'minikube service dashboard-ui -n $(NAMESPACE) --url')."
	@echo ""

logs-engine: ## Tail engine logs
	@kubectl logs -f deploy/dashboard-engine -n $(NAMESPACE)

logs-ui: ## Tail UI (nginx) logs
	@kubectl logs -f deploy/dashboard-ui -n $(NAMESPACE)

restart-engine: ## Restart the engine deployment (re-reads the Secret)
	@kubectl rollout restart deploy/dashboard-engine -n $(NAMESPACE)
	@kubectl rollout status deploy/dashboard-engine -n $(NAMESPACE) --timeout=180s

restart-ui: ## Restart the UI deployment
	@kubectl rollout restart deploy/dashboard-ui -n $(NAMESPACE)
	@kubectl rollout status deploy/dashboard-ui -n $(NAMESPACE) --timeout=180s

port-forward: ## Forward the UI service to http://localhost:$(LOCAL_PORT)
	@echo "==> Forwarding svc/dashboard-ui -> http://localhost:$(LOCAL_PORT) (Ctrl-C to stop)"
	@kubectl port-forward -n $(NAMESPACE) svc/dashboard-ui $(LOCAL_PORT):80

# --- Kiosk (Mac Mini boot-to-dashboard) --------------------------------------
cluster-up: ## Create the kind cluster with the fixed UI port mapping (no-op if it exists)
	@if ! command -v kind >/dev/null 2>&1; then \
	  echo "kind is required: https://kind.sigs.k8s.io/docs/user/quick-start/"; exit 1; \
	fi; \
	if kind get clusters 2>/dev/null | grep -qx "$(KIND_CLUSTER)"; then \
	  echo "kind cluster '$(KIND_CLUSTER)' already exists"; \
	else \
	  echo "==> Creating kind cluster '$(KIND_CLUSTER)' from k8s/kind-cluster.yaml"; \
	  kind create cluster --name "$(KIND_CLUSTER)" --config k8s/kind-cluster.yaml; \
	fi

kiosk-install: ## Install the kiosk LaunchAgents (boot-to-dashboard + 5-min auto-update)
	@$(SCRIPTS)/kiosk/install-kiosk.sh

kiosk-uninstall: ## Remove the kiosk LaunchAgents
	@$(SCRIPTS)/kiosk/install-kiosk.sh --uninstall

kiosk-doctor: ## Check the device is set up for kiosk mode (read-only diagnostics)
	@$(SCRIPTS)/kiosk/doctor.sh

kiosk-quiet: ## Silence macOS interruptions for kiosk use (update prompts, screen saver, sleep)
	@$(SCRIPTS)/kiosk/quiet-macos.sh

undeploy: ## Delete workloads + Secret (keeps the namespace)
	@echo "==> Removing dashboard resources from '$(NAMESPACE)'"
	@kubectl delete -f k8s/ui-deployment.yaml --ignore-not-found
	@kubectl delete -f k8s/engine-deployment.yaml --ignore-not-found
	@kubectl delete secret dashboard-engine-secrets -n $(NAMESPACE) --ignore-not-found

clean: undeploy ## Delete everything including the namespace
	@kubectl delete namespace $(NAMESPACE) --ignore-not-found
	@echo "==> Namespace '$(NAMESPACE)' removed."
