# Dashboard UI image (React + Vite, served by Nginx).
#
# IMPORTANT: build with the *repository root* as the build context so the
# workspace package manifests and lockfile are available:
#
#   docker build -f packages/ui/Dockerfile -t fansfund-ops/dashboard-ui:latest .
#
# Multi-stage:
#   1. builder - installs workspace deps and produces the static Vite bundle.
#   2. runtime - serves the bundle with Nginx, proxying /api to the engine.

# ---------------------------------------------------------------------------
# Stage 1: build the static assets
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy the root manifests plus every workspace manifest first for cacheable installs.
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/

RUN npm ci

# Copy the sources the UI build needs (shared types + UI app + build config).
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/ui/tsconfig.json packages/ui/
COPY packages/ui/vite.config.ts packages/ui/postcss.config.js packages/ui/tailwind.config.js packages/ui/index.html packages/ui/
COPY packages/ui/src packages/ui/src

# `build:app` runs `vite build`, emitting the static bundle to packages/ui/dist.
RUN npm run build:app --workspace @fans-fund-me/ui

# ---------------------------------------------------------------------------
# Stage 2: serve with Nginx
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Replace the default site with our SPA + /api proxy configuration.
COPY packages/ui/nginx.conf /etc/nginx/conf.d/default.conf

# Publish the compiled static assets.
COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
