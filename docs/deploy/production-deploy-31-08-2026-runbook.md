# Production deploy runbook — 2026-08-31

Deploying real Vertex AI (Gemini 2.5 Flash primary) + OpenAI gpt-5-mini (chat fallback) chat, and
the worker ingestion pipeline (`worker-parse`/`worker-ai`/`worker-index`) — all previously code-only,
never run on the live VM. Full background: `docs/plans/vertex-llm-provider-wiring-31-08-2026-plan.md`.

This deploy has one property the 2026-08-30 runbook didn't: it needs a **secret file** copied to
the VM (`vertex-key.json`), not just env vars and images. Missing that step doesn't fail loud — the
containers boot fine and silently fall back to Fake providers. Follow the order below; step 2 before
step 4 matters.

## 0. Pre-flight — already done

Work is already committed and pushed to `origin/main`:
- `8a515b0` — favorites feature (unrelated, landed alongside)
- `7cdcba7` — Vertex primary + OpenAI fallback + worker Dockerfile fix + deploy wiring

```bash
git log --oneline -2   # confirm you're deploying from these
git status --short     # should be clean except unrelated scratch files (home-shell.png, login.txt, tmp/, etc.)
```

If clean, skip to step 1. Re-run the full check only if you've made further edits since:
```bash
pnpm turbo run build lint test:unit
```

## 1. Set the required environment variables

Carried over from the 2026-08-30 runbook:
```bash
export REGISTRY=mtz.ocir.io/axjceqpmgl6l   # `oci os ns get` if you don't have it handy
export DOMAIN=bahat.co.il
export VM_HOST=84.13.85.78
export VM_USER=opc
export SMOKE_EMAIL=<a real tenant login on production>
export SMOKE_PASSWORD=<its password>
```

**New for this deploy:**
```bash
export VERTEX_PROJECT_ID=kibo-kms
export VERTEX_REGION=europe-west4
# The real service-account key generated 2026-08-31, still sitting in this machine's scratchpad —
# copy it somewhere durable first (it's session-scoped and could be cleaned up):
cp /private/tmp/claude-502/-Users-ehud-workspace-kms/d6aac37e-3d56-4b42-8f41-841b83232fb7/scratchpad/vertex-sa-key.json \
   ~/vertex-key.json
```
`OPENAI_API_KEY` is already in your local `.env` (root of the repo) — no separate export needed if
you source it: `set -a; source .env; set +a` (do this in a shell you trust; it also loads `MONGO_URI`
and other real secrets into your environment).

If you haven't logged in to OCIR yet this session:
```bash
docker login mtz.ocir.io -u '<namespace>/<username>' -p '<auth-token>'
# generate an auth token via: oci iam auth-token create --description 'local deploy'
```

## 2. Copy the updated deploy config + secret file to the VM

`docker-compose.yml` changed (new worker services, Vertex/OpenAI env) and `vertex-key.json` has
never been on the VM at all — both must land there **before** `docker compose up -d` picks up the
new config, or the containers boot on stale config / missing credentials.

**Use `deploy/.env`, NOT the root `.env`.** The root `.env` (MongoDB Atlas onboarding + local dev
vars, `OPENAI_API_KEY`) and `deploy/.env` (the actual file the VM reads — `KMS_MASTER_KEY_HEX`,
`PASSWORD_PEPPER`, `OCI_DATA_BUCKET`, `OCI_NAMESPACE`, `MONGO_URI`, etc., filled in since the
original 2026-08-19 setup) are two different files. Copying the root one to the VM overwrites the
real deploy secrets with an incomplete file — confirmed the hard way 2026-09-01: `docker compose up`
failed with every deploy var reported missing. Fixed by appending the new vars to `deploy/.env`
instead (never re-print its content — it holds real secrets; append only, e.g.
`grep '^OPENAI_API_KEY=' .env >> deploy/.env`).

```bash
cd /Users/ehud/workspace/kms

# Add the new vars to deploy/.env (the real deploy file) if not already there:
grep -q '^VERTEX_PROJECT_ID=' deploy/.env || echo "VERTEX_PROJECT_ID=$VERTEX_PROJECT_ID" >> deploy/.env
grep -q '^VERTEX_REGION=' deploy/.env || echo "VERTEX_REGION=$VERTEX_REGION" >> deploy/.env
grep -q '^VERTEX_KEY_FILE=' deploy/.env || echo "VERTEX_KEY_FILE=./vertex-key.json" >> deploy/.env
grep -q '^OPENAI_API_KEY=' deploy/.env || grep '^OPENAI_API_KEY=' .env >> deploy/.env

scp deploy/.env deploy/docker-compose.yml deploy/Caddyfile ~/vertex-key.json "$VM_USER@$VM_HOST:~"
ssh "$VM_USER@$VM_HOST" "mv ~/vertex-sa-key.json ~/vertex-key.json 2>/dev/null; true"  # only if the key file's local basename differs
```

**Never commit `deploy/.env` or `vertex-key.json`** — both hold real secrets; `.gitignore` already
excludes `deploy/.env`, and `vertex-key.json` should never be `git add`ed either. A "file changed on
disk" notification after editing a secrets file can itself display the diff in plaintext — append
with redirects (`>>`), don't `cat`/`Read` the file back to verify.

## 3. Build + push all four images (worker is new)

`deploy/smoke-deploy.sh` now builds+pushes `api`/`portal-api`/`web`/`worker` (updated this session
to include the worker image, which didn't exist in the pipeline before). Recommended path:

```bash
./deploy/smoke-deploy.sh
```

This builds all four arm64 images, pushes them, SSHes in and runs `docker compose pull && up -d`,
waits for `/health`, then runs the real Playwright smoke test against the live site.

If `docker push` fails with `unknown: Unauthorized` on a blob `HEAD` request (known Docker Desktop
for Mac ↔ OCIR bug, not a credentials problem — see `deploy/README.md`):
```bash
brew install crane   # if not already installed
docker save $REGISTRY/kms-worker:latest -o /tmp/kms-worker.tar
crane push /tmp/kms-worker.tar $REGISTRY/kms-worker:latest
# repeat per image that failed
```

### Manual fallback (if you need to isolate a failing stage)

```bash
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t $REGISTRY/kms-api:latest --push .
docker buildx build --platform linux/arm64 -f apps/portal-api/Dockerfile -t $REGISTRY/kms-portal-api:latest --push .
docker buildx build --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_PORTAL_API_URL= \
  -f apps/web/Dockerfile -t $REGISTRY/kms-web:latest --push .
docker buildx build --platform linux/arm64 -f apps/worker/Dockerfile -t $REGISTRY/kms-worker:latest --push .

ssh "$VM_USER@$VM_HOST" "cd ~ && sudo docker compose pull && sudo docker compose up -d"
ssh "$VM_USER@$VM_HOST" "sudo docker compose ps"
```

## 4. Post-deploy verification

**a) Health check:**
```bash
curl -sf https://kiboapi.$DOMAIN/health
```

**b) Confirm the worker containers are actually up and consuming their queues** (the whole point of
this deploy — they've never run in production before):
```bash
ssh "$VM_USER@$VM_HOST" "sudo docker compose ps worker-parse worker-ai worker-index"
ssh "$VM_USER@$VM_HOST" "sudo docker compose logs --tail=20 worker-parse worker-ai worker-index"
```
Look for each printing `worker pool "<pool>" ready — N queue(s) consumed` (from `apps/worker/src/main.ts`)
with **no** `MODULE_NOT_FOUND` or IAM/credential errors. `MODULE_NOT_FOUND` would mean the
Dockerfile fix didn't actually make it into the pushed image — re-check step 3.

**c) Real, currently-missing gap: no tenant has chat enabled yet.** `featureToggles.llm` is off by
default (ADR-0012) and — confirmed while writing this runbook — **there is no admin API endpoint to
turn it on**; `portal-api`'s `PATCH /tenants/:id` only accepts `name`/`edition`/`subdomain`/
`themeColorRgb`. The only way to enable it today is a direct MongoDB update:
```bash
# Using the same MONGO_URI as .env (mongosh, or Atlas UI's collection view):
mongosh "$MONGO_URI" --eval '
  db.tenants.updateOne(
    { subdomain: "<your beta tenant subdomain>" },
    { $set: { featureToggles: ["llm"] } }
  )
'
```
Worth a real follow-up: build a proper admin toggle for this instead of relying on direct DB writes.

**d) Live-verify a real chat round trip** — the actual goal of this whole deploy:
1. Log in to `https://kibo.$DOMAIN` as a user of the tenant you just flagged.
2. Upload a real document to a folder you have access to.
3. Watch it move through `queued` → `indexed` (worker logs from 4b, or refresh the document's status
   in the UI) — this can take a few seconds to a minute depending on document size.
4. Open `/chat`, ask a question the document can actually answer. Confirm you get a real, cited,
   Gemini-generated answer (not the Fake provider's canned response — compare against what Fake
   normally returns if you're unsure).
5. Ask an unrelated question — confirm the not-found response, not a hallucinated answer.
6. Optional: temporarily unset `VERTEX_PROJECT_ID` on the VM and restart `api` to confirm the
   OpenAI fallback actually engages (`OpenAiChatProvider`) — real evidence the fallback path works,
   not just that it compiles. Restore `VERTEX_PROJECT_ID` afterward.

## Rollback

Same as the 2026-08-30 runbook — no automated rollback, single-VM/no-HA by design (ADR-0015):
```bash
ssh "$VM_USER@$VM_HOST"
cd ~
sudo docker compose down
sudo docker compose up -d   # restarts from whatever images are cached locally on the VM
```
If you want a guaranteed-good fallback, tag current production images before overwriting `:latest`:
```bash
docker tag $REGISTRY/kms-api:latest $REGISTRY/kms-api:pre-2026-08-31
docker push $REGISTRY/kms-api:pre-2026-08-31
# repeat per image before running step 3
```

A partial rollback specific to this deploy: if the worker containers are misbehaving but api/web are
fine, you can stop just the workers without touching the rest of the stack:
```bash
ssh "$VM_USER@$VM_HOST" "cd ~ && sudo docker compose stop worker-parse worker-ai worker-index"
```
This returns to the pre-2026-08-31 behavior (uploads stay `queued` forever, chat has nothing to
retrieve) without affecting folders/permissions/groups, which never depended on the workers.
