# Production deploy runbook — 2026-08-30

Deploying the current uncommitted work to the live OCI VM (`84.13.85.78`, `il-jerusalem-1`,
`bahat.co.il`). Covers everything accumulated this session: the Kibo subdomain rename
(app→kibo, api→kiboapi, admin→kiboadmin), Item 6 (root-folder permission modal + cross-group
visibility), and the "demo" tenant rename 500 fix (`ZodExceptionFilter` + frontend `subdomain`
omit-when-empty fix). Follow in order — each step depends on the one before it.

## 0. Pre-flight: commit the work

Nothing below can be built from files that only exist on disk in a meaningful, reproducible way —
commit first so the deployed images trace back to a real commit, not "whatever was in the working
tree at the time."

```bash
git status --short
```

**Exclude these from the commit** — they're scratch/download artifacts unrelated to the deploy, not
part of the codebase:
`home-shell.png`, `login-check.png`, `login.txt`, `run.sh`, `stitch_automated_document_reviewer/`,
`tmp/`. Don't `git add -A`; stage the real changes explicitly (or `git add -u` for modified files
plus the specific new files below).

New files that **are** part of this work and should be committed:
`apps/portal-api/src/platform-admin/zod-exception.filter.ts`,
`apps/portal-api/src/platform-admin/zod-exception.filter.spec.ts`,
`apps/web/app/users/new/`, `apps/web/components/back-button.tsx`,
`apps/web/components/create-root-folder-modal.tsx`,
`docs/plans/root-folder-grants-cross-visibility-30-08-2026-plan.md`,
`docs/plans/product-gaps-batch-29-08-2026-plan.md` (if you want that plan tracked too — check its
content first if you don't recognize it).

```bash
git add -u
git add apps/portal-api/src/platform-admin/zod-exception.filter.ts \
        apps/portal-api/src/platform-admin/zod-exception.filter.spec.ts \
        apps/web/app/users/new/ \
        apps/web/components/back-button.tsx \
        apps/web/components/create-root-folder-modal.tsx \
        docs/plans/root-folder-grants-cross-visibility-30-08-2026-plan.md
git status --short   # confirm nothing unexpected is staged
git commit -m "feat: Kibo subdomain rename, root-folder grants (Item 6), tenant-rename 500 fix"
```

## 1. Confirm the build is green

Already verified this session (portal-api build/tests isolated, auth/data isolated, full
`turbo run build lint test:unit` — the only failures seen were Argon2id timing flakiness under
full parallel load, not real regressions). If you've made any further edits since, re-run:

```bash
pnpm turbo run build lint test:unit
```

## 2. Set the required environment variables

These are yours to fill in (not stored in the repo):

```bash
export REGISTRY=mtz.ocir.io/<your-oci-namespace>   # `oci os ns get` if you don't have it handy
export DOMAIN=bahat.co.il
export VM_HOST=84.13.85.78
export VM_USER=opc                                  # default, matches infra/'s Oracle Linux 9 image
export SMOKE_EMAIL=<a real tenant login on production>
export SMOKE_PASSWORD=<its password>
```

`SMOKE_EMAIL`/`SMOKE_PASSWORD` must be a **real, working** production account — the smoke test
logs in for real. (This is exactly the credential mismatch that caused the two `waitForURL`
failures diagnosed earlier this session; get these right or the gate will fail on bad test data,
not a real regression.)

If you haven't logged in to OCIR yet this session:

```bash
docker login mtz.ocir.io -u '<namespace>/<username>' -p '<auth-token>'
# generate an auth token via: oci iam auth-token create --description 'local deploy'
```

## 3. Deploy — automated path (recommended)

`deploy/smoke-deploy.sh` builds+pushes all three arm64 images with the correct build args
(`NEXT_PUBLIC_API_URL=/api` baked into `web` — load-bearing, not optional, see
`deploy/README.md`), deploys over SSH, waits for `/health`, then runs the real Playwright smoke
test against the live site and **fails loud** if login doesn't actually work.

```bash
cd /Users/ehud/workspace/kms
./deploy/smoke-deploy.sh
```

This takes several minutes (arm64 cross-build + push + SSH deploy + smoke test). Watch for:
- Each `docker buildx build ... --push` completing without error.
- `API is healthy.` — confirms `/health` responded through Caddy with a real cert.
- The final `pnpm exec playwright test` run passing — this is real evidence login and the
  deployed changes work, not just that containers started.

If `docker push` fails with `unknown: Unauthorized` on a blob `HEAD` request (a known Docker
Desktop for Mac ↔ OCIR client bug, not a credentials problem — see `deploy/README.md`), work
around it:

```bash
brew install crane   # if not already installed
docker save $REGISTRY/kms-web:latest -o /tmp/kms-web.tar
crane push /tmp/kms-web.tar $REGISTRY/kms-web:latest
# repeat per image that failed
```

## 4. Deploy — manual fallback (if you need more control)

Only use this if step 3 fails somewhere and you want to isolate which stage broke.

```bash
# Build + push each image (arm64 only — the VM is Ampere A1)
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t $REGISTRY/kms-api:latest --push .
docker buildx build --platform linux/arm64 -f apps/portal-api/Dockerfile -t $REGISTRY/kms-portal-api:latest --push .
docker buildx build --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_PORTAL_API_URL= \
  -f apps/web/Dockerfile -t $REGISTRY/kms-web:latest --push .

# Copy updated deploy config to the VM (only needed if Caddyfile/docker-compose.yml changed,
# which they did this session)
scp deploy/docker-compose.yml deploy/Caddyfile $VM_USER@$VM_HOST:~

# Deploy
ssh $VM_USER@$VM_HOST "cd ~ && sudo docker compose pull && sudo docker compose up -d"

# Watch it come up
ssh $VM_USER@$VM_HOST "sudo docker compose ps && sudo docker compose logs --tail=50 api portal-api web caddy"
```

## 5. Post-deploy verification

**a) Health check:**
```bash
curl -sf https://kiboapi.$DOMAIN/health
```

**b) Confirm the "demo" tenant rename fix actually works** (the reason this deploy exists) — log
in to `https://kiboadmin.$DOMAIN` as the platform-admin superuser, open the "demo" tenant, and
save an edit (e.g. rename it) without touching the subdomain field. It should succeed silently
instead of showing "Internal server error". Then deliberately enter an invalid subdomain (e.g.
`AB`) and confirm you now get a clear validation error, not a 500.

**c) Confirm the platform-admin superuser was actually seeded** — you reported errors on your
last two seed attempts (`node` not on `$PATH` in the distroless image, then `node` passed as a
literal argument by mistake). The corrected command, run **after** this deploy so it targets the
current image:

```bash
ssh $VM_USER@$VM_HOST
cd ~
sudo docker compose run --rm \
  -e SEED_ADMIN_EMAIL=<your email> \
  -e SEED_ADMIN_PASSWORD=<a strong password> \
  portal-api dist/bootstrap/seed.js
```

No `node` anywhere in that command — the distroless image's own `ENTRYPOINT` already is `node`;
adding it yourself breaks the argument parsing. Look for `Seed complete: platform admin ...
Enroll TOTP on first login.` in the output. Idempotent on email, safe to re-run.

**d) Spot-check Item 6** (root-folder permission modal) live: create a root folder with a group
grant, confirm the group appears in the folder's "why can X see this" / visibility panel.

## Rollback

If the smoke test fails or something looks wrong in production:

```bash
ssh $VM_USER@$VM_HOST
cd ~
sudo docker compose pull   # only if you want to re-pull; otherwise skip
# roll back to a known-good tag if you tagged one, or:
sudo docker compose down
sudo docker compose up -d   # restarts from whatever images are cached locally on the VM
```

There is no automated rollback — per `deploy/README.md`'s "Operational gaps" section, this is a
single-VM, no-HA topology by design (ADR-0015). If you need a guaranteed-good fallback, tag the
current production images before overwriting `:latest` (`docker tag $REGISTRY/kms-api:latest
$REGISTRY/kms-api:pre-2026-08-30` and push that, before running step 3).
