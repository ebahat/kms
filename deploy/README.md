# Deploying v1.0 (ADR-0015, single VM on OCI Always Free)

Target: one Ampere A1 VM (2 OCPU / 12 GB, **arm64**) running `docker-compose.yml` behind Caddy.
Provisioned by `infra/`. Runs unchanged on Hetzner or any VPS — only `REGISTRY` and DNS change.

## Order of operations

DNS must resolve **before** the first deploy, or Caddy cannot obtain Let's Encrypt certificates.

1. **Provision** — `cd infra && terraform apply`, then note `terraform output public_ip`.
2. **DNS** — point three A-records at that IP:
   `api.<domain>`, `admin.<domain>`, `app.<domain>`. Verify with `dig +short api.<domain>`.
3. **Build and push arm64 images** (see below).
4. **Deploy** — copy `docker-compose.yml`, `Caddyfile`, and a filled-in `.env` to the VM, then
   `docker compose up -d`.
5. **Seed the first accounts** — `docker compose exec api node dist/bootstrap/seed.js`
   (and the equivalent in `portal-api`). Needs `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/
   `SEED_TENANT_NAME` in the environment; idempotent on email.

## Building for arm64 (the one real gotcha)

Ampere A1 is **ARM**. Images built on an x86 CI runner or an Intel Mac will not run. Build
multi-arch, or build natively on the VM.

```bash
# From the repo root, on a machine with buildx (Apple Silicon builds arm64 natively):
docker buildx build --platform linux/arm64 \
  -f apps/api/Dockerfile -t $REGISTRY/kms-api:latest --push .
# repeat for portal-api

# web needs two extra --build-arg flags — see the callout below, this is not optional.
# NEXT_PUBLIC_API_URL=/api (a relative path, NOT https://api.<domain>) — see the same-origin
# callout below, this is load-bearing for login to work at all, not a style choice.
docker buildx build --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_PORTAL_API_URL= \
  -f apps/web/Dockerfile -t $REGISTRY/kms-web:latest --push .
```

**`web`'s `NEXT_PUBLIC_API_URL` must be `/api`, a relative path, not `https://api.<domain>` —
CONFIRMED 2026-08-21 the hard way, full writeup in
`docs/architecture/deploy-retro-21-08-2026-review.md`.** `apps/api` sets zero CORS headers, and the
tenant session cookie uses the `__Host-` prefix (pins it to the exact host that set it, per spec) —
together these make a cross-origin split between `app.<domain>` (UI) and `api.<domain>` (API)
**architecturally incompatible with login working at all**, not just slower or less elegant. The
fix is routing the API under the same origin as the UI: `deploy/Caddyfile`'s `app.{$DOMAIN}` block
does `handle_path /api/*` → `api:3000` before falling through to `web:3010`, and `web` must be
built with `NEXT_PUBLIC_API_URL=/api` to match. `NEXT_PUBLIC_PORTAL_API_URL` stays empty — the
admin realm was already accidentally same-origin (`admin.<domain>` serves both the admin UI and,
via a path matcher, `portal-api`) and doesn't need this.

**`web`'s two `--build-arg`s are required, not optional.**
`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_PORTAL_API_URL` are read by client-bundle code and Next.js only
inlines `NEXT_PUBLIC_*` values at `next build` time (webpack `DefinePlugin`) — **never** at container
runtime. Setting them in `docker-compose.yml`'s `environment:` block (an earlier version of this repo
did exactly that) has zero effect on an already-built image: every browser request silently falls back
to the `http://localhost:3000` default baked into the bundle, and every login attempt fails with a
generic "invalid email or password" — with **zero matching activity in the API's logs**, since the
request never left the user's own machine. If you ever see that pattern (auth fails client-side, API
logs show nothing), check this first. Verify a rebuild actually picked up the real URLs before
pushing: `docker run --rm $REGISTRY/kms-web:latest sh -c "grep -c localhost:3000 apps/web/.next/static/chunks/*.js"`
should show all zeros.

**Proven 2026-08-18**: all three images (`api`, `portal-api`, `web`) build and boot clean under
`--platform linux/arm64`; `argon2`'s native binding was confirmed working end-to-end. See ADR-0015.

OCIR login: `docker login mtz.ocir.io -u '<namespace>/<username>' -p '<auth-token>'` — OCIR hostnames
use the region's short **key** (`mtz` for `il-jerusalem-1`), not the full region name; can also be
generated via `oci iam auth-token create --description '...'` instead of the Console.

**If `docker push` fails with `unknown: Unauthorized` on a blob `HEAD` request** (confirmed
2026-08-19, against `il-jerusalem-1`'s OCIR specifically, on Docker Desktop for Mac) — this was a
client-side bug, not a credentials/permissions problem (verified via raw HTTP: OCIR's OAuth2
token-exchange, both unscoped and repo-scoped, both succeeded cleanly). Work around with `crane`
(`brew install crane`): `docker save $REGISTRY/kms-web:latest -o image.tar && crane push image.tar
$REGISTRY/kms-web:latest`. Plain `docker pull` on the VM's own (newer) Docker CE had no such issue —
this only affects the local build/push leg.

## Deploy gate

`deploy/smoke-deploy.sh` wraps build+push+deploy+verify into one script: builds and pushes all
three arm64 images with the args above, deploys to the VM over SSH (`docker compose pull && up
-d`), waits for `/health`, then runs `apps/web/e2e/production-smoke.spec.ts` against the real live
URL and exits non-zero if it doesn't pass. This is the retro action (2026-08-21) that turns "someone
notices login is broken after the fact" into a deploy that fails loud. Needs `REGISTRY`, `DOMAIN`,
`VM_HOST`, `SMOKE_EMAIL`, `SMOKE_PASSWORD` in the environment (`VM_USER` defaults to `opc`) — see
the script's own header for details. Not wired into CI; run it by hand until there is one.

## What is NOT deployed here, on purpose

`worker-parse`, `worker-ai`, `worker-index`, `clamd` — all Phase 3 (ingestion/OCR), descoped from
v1.0 on 2026-08-15. Uploaded files land in Object Storage and stay `status: 'queued'` forever, which
is the expected v1.0 behaviour, not a bug. Folder browsing, permissions, groups, upload and download
all work without them.

## Operational gaps you are accepting (ADR-0015)

- **No HA.** One VM, one availability domain. VM loss is a full outage. PRD §13's 99.5% is a *launch*
  target and is **not** met by this topology.
- **No automated backups.** Atlas M0 has none either — script a `mongodump` before real data lands.
  Object Storage is the system of record for files and is separately durable.
- **No WAF.** Caddy provides TLS and security headers, not OWASP-CRS inspection.

## Free-tier ceilings — exceed any of these and billing starts

| Resource | Allowance |
|---|---|
| Compute | 2 OCPU / 12 GB (1,500 OCPU-hrs + 9,000 GB-hrs per month) |
| Block storage | 200 GB total (this VM uses 50 GB) |
| Object Storage | 20 GB, **50,000 API requests/month** |
| Egress | 10 TB/month |

The API-request ceiling is the one most likely to bite first: every upload, download-URL issuance,
and deletion-verification check counts. Set a budget alert in the OCI Console (Billing → Budgets) —
Always Free does not hard-stop at the limit, it bills the overage.
