#!/usr/bin/env bash
set -euo pipefail

# Deploy gate (retro action 4, docs/architecture/deploy-retro-21-08-2026-review.md, 2026-08-21).
# Wraps build+push+deploy+verify so a login-breaking regression (Bug 1's whole failure mode —
# CORS/__Host- cookie topology mismatch) fails this script instead of depending on a human
# noticing after the fact. Does not run anything destructive on the VM beyond `docker compose
# pull && up -d` with images this same run just built.
#
# Required env: REGISTRY, DOMAIN, VM_HOST, SMOKE_EMAIL, SMOKE_PASSWORD
# Optional env: VM_USER (default opc, matches infra/'s Oracle Linux 9 image), TAG (default latest)
#
# Run from the repo root: REGISTRY=... DOMAIN=... VM_HOST=... SMOKE_EMAIL=... SMOKE_PASSWORD=... \
#   ./deploy/smoke-deploy.sh

: "${REGISTRY:?REGISTRY is required (e.g. mtz.ocir.io/<namespace>)}"
: "${DOMAIN:?DOMAIN is required (e.g. bahat.co.il)}"
: "${VM_HOST:?VM_HOST is required (the VM public IP or hostname)}"
: "${SMOKE_EMAIL:?SMOKE_EMAIL is required, a real tenant account to log in as}"
: "${SMOKE_PASSWORD:?SMOKE_PASSWORD is required}"
VM_USER="${VM_USER:-opc}"
TAG="${TAG:-latest}"

echo "==> Building and pushing arm64 images ($REGISTRY, tag $TAG)"
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t "$REGISTRY/kms-api:$TAG" --push .
docker buildx build --platform linux/arm64 -f apps/portal-api/Dockerfile -t "$REGISTRY/kms-portal-api:$TAG" --push .
# One image, three WORKER_POOL deploys (worker-parse/worker-ai/worker-index in docker-compose.yml).
docker buildx build --platform linux/arm64 -f apps/worker/Dockerfile -t "$REGISTRY/kms-worker:$TAG" --push .
# NEXT_PUBLIC_API_URL=/api is not a default — it's the fix for Bug 1. See deploy/README.md.
docker buildx build --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_PORTAL_API_URL= \
  -f apps/web/Dockerfile -t "$REGISTRY/kms-web:$TAG" --push .

echo "==> Deploying to $VM_USER@$VM_HOST"
ssh "$VM_USER@$VM_HOST" "cd ~ && sudo docker compose pull && sudo docker compose up -d"

echo "==> Waiting for /health"
for _ in $(seq 1 30); do
  if curl -sf "https://kiboapi.$DOMAIN/health" >/dev/null 2>&1; then
    echo "API is healthy."
    break
  fi
  sleep 2
done

echo "==> Running the production smoke test against https://kibo.$DOMAIN"
SMOKE_BASE_URL="https://kibo.$DOMAIN" SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" \
  pnpm --filter @kms/web exec playwright test e2e/production-smoke.spec.ts

echo "==> Deploy verified: images pushed, VM updated, real login confirmed working."
