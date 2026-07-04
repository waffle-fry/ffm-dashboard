# Dashboard Engine image (Node.js + TypeScript).
#
# IMPORTANT: build with the *repository root* as the build context so the
# workspace package manifests and lockfile are available:
#
#   docker build -f packages/engine/Dockerfile -t fansfund-ops/dashboard-engine:latest .
#
# Multi-stage:
#   1. builder  - installs all workspace deps, builds @fans-fund-me/shared and
#                 @fans-fund-me/engine via TypeScript project references.
#   2. runtime  - installs production deps only and runs the compiled server.
#
# The engine listens on 8080 (matches the ClusterIP Service `dashboard-engine`)
# and reads all its configuration from environment variables (see k8s/secrets.yaml).

# ---------------------------------------------------------------------------
# Stage 1: build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy the root manifests plus every workspace manifest first so the dependency
# install layer is cached independently of source changes.
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/

# Install the full workspace dependency tree (dev deps needed to compile TS).
RUN npm ci

# Copy the sources the engine build needs (shared types + engine source).
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/engine/src packages/engine/src

# `tsc --build` on the engine follows project references and compiles
# @fans-fund-me/shared first, so dist output for both packages is produced.
RUN npm run build --workspace @fans-fund-me/engine

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Re-declare the workspace manifests and install production dependencies only.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
RUN npm ci --omit=dev

# Copy the compiled output. @fans-fund-me/shared is a types-only package (its
# exports are erased at compile time), so only its manifest is needed at
# runtime for the workspace symlink; the engine's dist is what actually runs.
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/engine/dist packages/engine/dist

# Run as the built-in non-root `node` user.
USER node

WORKDIR /app/packages/engine

EXPOSE 8080

# Mirrors the package `start` script: `node dist/index.js`.
CMD ["node", "dist/index.js"]
