# Deploying v1.0 (ADR-0015, single VM on OCI Always Free)

Target: one Ampere A1 VM (2 OCPU / 12 GB, **arm64**) running `docker-compose.yml` behind Caddy.
Provisioned by `infra/`. Runs unchanged on Hetzner or any VPS — only `REGISTRY` and DNS change.

## Order of operations

DNS must resolve **before** the first deploy, or Caddy cannot obtain Let's Encrypt certificates.

1. **Provision** — `cd infra && terraform apply`, then note `terraform output public_ip`.
2. **DNS** — point three A-records at that IP:
   `kiboapi.<domain>`, `kiboadmin.<domain>`, `kibo.<domain>` (all three prefixed/named for the
   product rather than plain "api"/"admin"/"app", since those bare subdomains may already be taken
   on a shared personal/company domain — rename them in `Caddyfile`, `APP_PUBLIC_URL`, and
   `apps/web/middleware.ts`'s admin-host check together if you use different ones).
   Verify with `dig +short kiboapi.<domain>`.
3. **Build and push arm64 images** (see below).
4. **Deploy** — copy `docker-compose.yml`, `Caddyfile`, and a filled-in `.env` to the VM, then
   `docker compose up -d`.
5. **Seed the first accounts** — `docker compose run --rm -e SEED_ADMIN_EMAIL=... -e
   SEED_ADMIN_PASSWORD=... [-e SEED_TENANT_NAME=... for api only] api dist/bootstrap/seed.js` (and
   the equivalent for `portal-api`). **Not** `docker compose exec ... node ...` — `api` and
   `portal-api` both run on `gcr.io/distroless/nodejs22-debian12` (no shell, no `node` reachable by
   name for `exec` to find — confirmed 2026-08-30 the hard way, `exec: "node": executable file not
   found in $PATH`). `docker compose run` sidesteps this: it starts a fresh one-off container from
   the same image and passes the script path as the replacement `CMD`, which the distroless image's
   own baked-in `ENTRYPOINT` (already the node binary) runs directly — no need to locate `node` on
   disk at all. `MONGO_URI`/`PASSWORD_PEPPER` are picked up automatically from the service's own
   `environment:` block in `docker-compose.yml`, same as the running container. Idempotent on email.
   (`web` is the one service NOT on distroless — plain `node:22-slim` — so `exec` would have worked
   there, but it has no seed script.)

## Building for arm64 (the one real gotcha)

Ampere A1 is **ARM**. Images built on an x86 CI runner or an Intel Mac will not run. Build
multi-arch, or build natively on the VM.

```bash
# From the repo root, on a machine with buildx (Apple Silicon builds arm64 natively):
docker buildx build --platform linux/arm64 \
  -f apps/api/Dockerfile -t $REGISTRY/kms-api:latest --push .
# repeat for portal-api and worker (apps/worker/Dockerfile — one image, three WORKER_POOL deploys)

# web needs two extra --build-arg flags — see the callout below, this is not optional.
# NEXT_PUBLIC_API_URL=/api (a relative path, NOT https://api.<domain>) — see the same-origin
# callout below, this is load-bearing for login to work at all, not a style choice.
docker buildx build --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_PORTAL_API_URL= \
  -f apps/web/Dockerfile -t $REGISTRY/kms-web:latest --push .
```

**`web`'s `NEXT_PUBLIC_API_URL` must be `/api`, a relative path, not an absolute API hostname —
CONFIRMED 2026-08-21 the hard way, full writeup in
`docs/architecture/deploy-retro-21-08-2026-review.md`.** `apps/api` sets zero CORS headers, and the
tenant session cookie uses the `__Host-` prefix (pins it to the exact host that set it, per spec) —
together these make a cross-origin split between the tenant UI hostname and the tenant API hostname
**architecturally incompatible with login working at all**, not just slower or less elegant. The
fix is routing the API under the same origin as the UI: `deploy/Caddyfile`'s `kibo.{$DOMAIN}` block
(named for the product; was `app.{$DOMAIN}` until 2026-08-30, renamed only because that subdomain
was already taken — the hostname string itself carries no other meaning) does `handle_path /api/*`
→ `api:3000` before falling through to `web:3010`, and `web` must be
built with `NEXT_PUBLIC_API_URL=/api` to match. `NEXT_PUBLIC_PORTAL_API_URL` stays empty — the
admin realm was already accidentally same-origin (`kiboadmin.<domain>` serves both the admin UI
and, via a path matcher, `portal-api`) and doesn't need this. (The standalone `kiboapi.<domain>`
site block in `Caddyfile` is a separate, directly-reachable API hostname — kept for parity/direct
access, though the tenant UI's own login flow no longer needs it now that it calls the API
same-origin via `kibo.<domain>/api/*`.)

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

## Vertex AI credentials (chat/embedding, wired 2026-08-31)

`worker-parse`/`worker-ai`/`worker-index` now run the real ingestion pipeline, and `api`/`worker-ai`
call real Vertex AI Gemini 2.5 Flash + `text-multilingual-embedding-002` — live-verified against a
real GCP project (`kibo-kms`). Before deploying:

1. A GCP project with `aiplatform.googleapis.com` enabled and billing linked.
2. A service account with `roles/aiplatform.user`, and a JSON key for it:
   ```bash
   gcloud iam service-accounts keys create vertex-key.json \
     --iam-account=<sa-name>@<project-id>.iam.gserviceaccount.com --project=<project-id>
   ```
3. Copy that `vertex-key.json` to the VM alongside `docker-compose.yml`/`.env` — **never commit it**.
   `docker-compose.yml` bind-mounts it read-only into `api`/`worker-ai` at `/secrets/vertex-key.json`
   (path overridable via `.env`'s `VERTEX_KEY_FILE`), and `GOOGLE_APPLICATION_CREDENTIALS` points
   there — this is Application Default Credentials via a key file, not the GCP metadata server (the
   VM is on OCI, not GCP, so there is no metadata server to fall back to).
4. Set `VERTEX_PROJECT_ID`/`VERTEX_REGION` in `.env` (see `.env.example`).

The system-of-record copy of this key lives in OCI Vault (`kms-<env>-provider-vertex`, rotated via
`oci vault secret update-secret-content` — same out-of-band pattern as the other provider-key
secrets in `infra/modules/vault/main.tf`, never through Terraform). The file on the VM is a runtime
artifact, not the source of truth — re-fetch it from Vault if the VM is ever rebuilt.

Chat is still gated behind ADR-0012's opt-in `'llm'` tenant feature flag — a tenant needs
`featureToggles.llm = true` (set via `portal-api`'s tenant-admin endpoints) before its users can
reach `/chat` at all, independent of whether real credentials are wired.

**Chat fallback (ADR-0008 amendment, 2026-08-31)**: if Vertex is unreachable or `VERTEX_PROJECT_ID`
is unset, `api` falls back to OpenAI `gpt-5-mini` — set `OPENAI_API_KEY` in `.env` (generate at
platform.openai.com/api-keys; no service-account/ADC complexity like Vertex, just the key). This
replaced Claude in the fallback role; `ClaudeChatProvider` is still in the codebase, unwired, should
the fallback slot move back. Same Vault system-of-record pattern as Vertex's key — the real value
lives in `kms-<env>-provider-openai-fallback`, rotated via `oci vault secret update-base64`.

## What is NOT deployed here, on purpose

`clamd` — Phase 3's malware-scan stage stays on `FakePassThroughScanProvider`; a real ClamAV binding
is separate, unstarted work. Uploaded files are still scanned (pass-through, not skipped), parsed,
chunked, embedded, and indexed for real as of 2026-08-31 — `worker-parse`/`worker-ai`/`worker-index`
are deployed (see above). Folder browsing, permissions, groups, upload and download all worked
without them before this; ingestion and chat now work too.

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
