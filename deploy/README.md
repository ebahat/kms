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
# repeat for portal-api, web
```

**Proven 2026-08-18**: all three images (`api`, `portal-api`, `web`) build and boot clean under
`--platform linux/arm64`; `argon2`'s native binding was confirmed working end-to-end. See ADR-0015.

OCIR login: `docker login il-jerusalem-1.ocir.io -u '<namespace>/<username>' -p '<auth-token>'`
(auth token from Console → Identity → Users → your user → Auth Tokens).

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
