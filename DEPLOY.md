# Deploying the Ops Dashboard

The dashboard runs as two containers on a local Kubernetes cluster: the
**engine** (Node.js API that aggregates Stripe/MongoDB/Grafana/S3) and the
**UI** (React SPA served by Nginx, which proxies `/api` to the engine).

Everything is driven by the `Makefile`. Run `make help` for the full list.

## Prerequisites

- **Docker** (running) — builds the images.
- **kubectl** + a reachable local cluster — kind, minikube, k3d, Docker
  Desktop, OrbStack, Rancher Desktop, or Colima all work. Images are loaded
  automatically for kind/minikube/k3d; the desktop/daemon-shared clusters need
  no load step.
- **Node.js** (only if you want to run `make test` / `make build-app`).

## One command

```bash
cp .env.example .env    # then fill in real values
make deploy
```

`make deploy` will:

1. **Preflight** — verify Docker + kubectl, that the cluster is reachable, and
   that every required environment variable is set. It **fails fast** and lists
   exactly what is missing.
2. **Build** both container images.
3. **Load** the images into your local cluster (auto-detected).
4. **Namespace + Secret** — create the `fansfund-ops` namespace and generate the
   engine config Secret from your environment / `.env` (never committed).
5. **Apply** the Deployments + Services and **wait** for both rollouts.

Then reach the UI:

```bash
make port-forward       # opens svc/dashboard-ui on http://localhost:8080
```

## Configuration

Set these in `.env` or your shell (real environment wins over `.env`):

| Variable | Required | Purpose |
|---|:---:|---|
| `STRIPE_API_KEY` | ✓ | Stripe secret key |
| `MONGODB_URI` | ✓ | MongoDB connection string |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | ✓ | S3 access for dispute evidence |
| `GRAFANA_URL`, `GRAFANA_API_KEY`, `GRAFANA_DATASOURCE_UID`, `GRAFANA_SERVICES` | ✓ | Grafana/Prometheus health metrics |
| `MONGODB_DB` | | DB name (if not in the URI) |
| `S3_DISPUTE_DOCS_BUCKET` | | Override the default bucket |
| `AWS_ROLE_ARN` | | IAM role to assume (via STS) before accessing S3 |
| `AWS_ROLE_SESSION_NAME` | | STS session name (default `fansfund-ops-dashboard`) |
| `AWS_ROLE_EXTERNAL_ID` | | STS external id (cross-account trust only) |
| `REFRESH_INTERVAL_MINUTES` | | Poll interval (1–60, default 5) |
| `SOURCE_TIMEOUT_MS` | | Per-source fetch timeout in ms (default 10000; raise for high-volume Stripe) |

Deploy-time knobs (override on the command line):

```bash
make deploy IMAGE_TAG=v1.2.3 NAMESPACE=fansfund-ops
```

`NAMESPACE`, `IMAGE_TAG`, `ENGINE_IMAGE`, `UI_IMAGE`, `LOCAL_PORT`.

## Fast per-component workflows

```bash
make deploy-engine     # rebuild + reload + redeploy only the engine (re-applies Secret)
make deploy-ui         # rebuild + reload + redeploy only the UI
make check-env         # validate required env vars without touching the cluster
make status            # deployments / pods / services
make logs-engine       # tail engine logs   (make logs-ui for the UI)
make restart-engine    # restart the engine so it re-reads the Secret
make undeploy          # remove workloads + Secret (keeps the namespace)
make clean             # remove everything, including the namespace
```

## Security notes

- The engine API is **unauthenticated** by design and is exposed only as a
  ClusterIP service (`dashboard-engine`). Only the UI is exposed (NodePort
  30080). Do not attach an Ingress/LoadBalancer to the engine.
- Credentials are injected via a Secret generated at deploy time from your
  environment. The committed `k8s/secrets.yaml` is a **placeholder template**
  and is not used by `make deploy`. Keep real values out of version control
  (`.env` is gitignored).
