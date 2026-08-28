# Deploy retro: first real login, three bugs (2026-08-21)

## Why this exists

The user's own framing, verbatim, is the mandate for this document: *"The very first interactions
do not work. I would like to develop a system I can trust. Review why it happened."* This is not a
postmortem for its own sake — it's the record of what broke on the very first real end-to-end use
of the deployed system (first tenant, first login, first MFA enrollment), why each bug slipped
through everything that came before it, and what changes close those specific gaps rather than
gaps in general.

## Timeline

1. `infra/` applied, `deploy/docker-compose.yml` running live on the VM (2026-08-19). DNS added,
   real Let's Encrypt certs issued (2026-08-20/21).
2. First tenant + admin seeded via `bootstrap/seed.ts`. User attempts to log in at
   `app.bahat.co.il` → **Bug 1: login fails**, three misdiagnosis rounds before the real cause was
   found.
3. Bug 1 fixed (same-origin routing). User logs in successfully, reaches the TOTP step —
   discovers they're being asked to complete enrollment for MFA they never set up.
   Investigation reveals **Bug 2: a Playwright smoke test I wrote had already auto-enrolled MFA on
   their real account**, locking it in a state only the test's own headless browser ever saw the
   secret/backup codes for.
4. User authorizes a one-time direct MongoDB write to unlock the account (Claude Code's own
   auto-mode classifier correctly blocked my first, unauthorized attempt at this).
5. This retro requested, plus a scan for further broken scenarios and a test-strategy fix.

## Bug 1 — login failure: CORS + `__Host-` cookie, compounded

**Symptom:** every login attempt returned "דוא"ל או סיסמה שגויים" (invalid email or password),
even with verified-correct credentials.

**Misdiagnosis rounds (this is the part worth dwelling on):**
- Round 1: suspected a password transcription error (the password had `!`/`&` in it). Ruled out
  by `curl`ing the exact credentials directly against the API — 200 OK.
- Round 2: suspected a stale cached bundle in the browser. Told the user to hard-refresh. No
  effect.
- Round 3, the real cause: checked Redis failure counters (empty — no failed attempts were ever
  recorded server-side at all), which was the tell. If the server never saw a failed attempt, it
  never saw an attempt. A direct `curl -X OPTIONS .../auth/login` preflight request returned a
  plain `404`, meaning the browser's CORS preflight was failing and **the real login POST was
  never being sent** — the UI's generic error handling made this look identical to a wrong
  password.

**Root cause, two independent problems that happened to compound:**
1. `apps/api`/`apps/portal-api` configure zero CORS middleware. A browser calling `api.<domain>`
   from a page served on `app.<domain>` is cross-origin; its preflight `OPTIONS` 404s and the
   actual request is never sent.
2. Even with CORS fixed, the session cookie (`__Host-kms_sess`) uses the `__Host-` prefix, which
   by spec (RFC 6265bis) requires `Secure` + `Path=/` + **no `Domain` attribute** — pinning the
   cookie to the exact host that set it. A cookie set by `api.<domain>` can never be sent by a page
   on `app.<domain>`, no matter what CORS allows. This was in fact a documented, deliberate design
   constraint (`apps/api/src/auth/cookie.ts`'s own comment says as much) — it just hadn't been
   checked against the hostname-split topology that ADR-0004/0007 chose.

**Why nothing caught this earlier:** every prior verification of the login flow was either a
`curl`/supertest call directly against the Nest app (never goes through a browser's CORS layer at
all) or `folders-groups.spec.ts`'s Playwright run against `next dev` on localhost, where
`NEXT_PUBLIC_API_URL` is unset and falls back to `http://localhost:3000` — accidentally
same-origin. **The test that looked like a safety net was structurally incapable of catching
either half of this bug**, because it never ran in the one topology (real hostname split) where
the bug existed.

**Fix:** route the tenant API under the same origin as the UI. `deploy/Caddyfile`'s
`app.{$DOMAIN}` block now does `handle_path /api/*` → `api:3000` before falling through to
`web:3010`, and the `web` image is built with `NEXT_PUBLIC_API_URL=/api` (a relative path) instead
of an absolute cross-origin URL. This fixes both problems at once without weakening either: no
CORS is needed because it isn't cross-origin anymore, and `__Host-` keeps its full strength since
the cookie's setting host and the page's host are now the same.

**Verification:** `apps/web/e2e/production-smoke.spec.ts`, a new Playwright suite that drives a
real browser against the real production URL and asserts (a) zero cross-origin requests occur
during login, (b) a real login succeeds and returns a `__Host-kms_sess` cookie with the correct
`secure`/`path`/`httpOnly`/`domain` attributes, (c) a wrong password is visibly rejected (not
silently swallowed the way the CORS failure was). Ran 4/4 green against the live deployment.

## Bug 2 — the smoke test that broke the thing it was verifying

**Symptom:** immediately after Bug 1's fix was verified, the user reported being asked to enroll
MFA they'd never set up.

**Root cause:** `apps/web/app/login/totp/page.tsx` reads `?enroll=1` from the URL, and a
`useEffect` unconditionally fires `POST /auth/totp/enroll` on mount whenever `needsEnroll &&
!enrollment`. That endpoint is destructive — it generates a brand-new TOTP secret, overwrites any
existing one, flips `mfaEnabled` to `true`, and returns the QR + 10 backup codes exactly once, with
no confirmation step and no idempotency guard.

The first version of `production-smoke.spec.ts` logged in as the real operator account, which
(correctly, before this incident) had no MFA yet — so the login redirected to
`/login/totp?enroll=1`, and the test's headless browser silently completed a real enrollment
against production. The secret and backup codes existed for a few seconds inside a throwaway
Playwright browser context and were then gone. **The test built specifically to prove login could
be trusted is what locked the user out of their own account.**

**Why nothing caught this before it ran against production:** the test was net-new, written to
verify Bug 1's fix, and was run directly against the live deployment (by design — that's the whole
point of a production smoke test) without first auditing every endpoint it would touch for
side effects. "It's read-only because it's just logging in" was an unstated, false assumption.

**Fix:** added a `beforeEach` guard —
`page.route('**/auth/totp/enroll', (route) => route.abort())` — with a comment explaining exactly
why, so the pattern doesn't get quietly deleted later. Every assertion the test needs (redirect,
cookie, credential acceptance) happens server-side before that endpoint would ever be reached, so
aborting it costs nothing. Verified by re-running the suite (still 4/4 green) and directly checking
MongoDB that `backupCodeCount` stayed at 10 (unchanged) rather than being silently regenerated.

**The generalizable lesson:** a post-deploy smoke test runs against production *by definition*, so
"non-mutating" isn't one property among several to check for — it's the precondition for the test
being allowed to exist at all. Every future production-facing test needs this audit before its
first live run, not after an incident.

## Bug 3 — password reset dead-ends at a 404

Reported by the user in the same conversation ("the forgot password is still leading to 404").
`POST /auth/password-reset/request` and `/confirm` were fully implemented and tested at the API
layer, but no frontend route ever called them, and — a second, independent problem found while
fixing the first — the request handler never actually sent the reset email even when called
correctly (blocked on a "transactional email provider decision" that ADR-0013 had, by that point,
already resolved for a different feature). Both are now fixed: see
`docs/plans/master-gaps-design-superuser-22-08-2026-plan.md` Phase A action 2.

## Cross-cutting finding: my own overconfidence

Before any of this was exercised against a live deployment, this project's own status tracking
(`CLAUDE.md`, plan documents) repeatedly described phases as "complete" based on unit tests, an
in-process `mongodb-memory-server` harness, and — at best — Playwright against `next dev` on
localhost. All three of the bugs above are cases where that language was accurate for what it
covered and actively misleading about what it implied: none of "complete," "tested," or "fully
covered" distinguished between *works in the test harness's topology* and *works in the real
one*. Bug 1 specifically only exists in the gap between those two topologies. The fix isn't more
tests of the same shape — it's a class of test that only the real topology can pass, run
deliberately (see below), not assumed from lower-level coverage.

## Additional scenarios reviewed, not found broken

Per the user's second ask ("review the system and try to attempt additional broken scenarios"),
these were checked and are correctly handled:
- Session expiry (idle 30 min / absolute 12 h) enforced server-side, independent of client state.
- Login lockout at 10 failures and the progressive delay before it are real (Redis-backed); the
  one caveat is `NoopCaptchaVerifier` always passes, so the CAPTCHA step is currently cosmetic —
  not a bug, a known placeholder (no CAPTCHA provider has been chosen yet).
- Cross-tenant isolation on every repository call (ADR-0001) — unaffected by the hostname-routing
  change, since tenant scoping never depended on hostname.
- Admin-hostname routing (`admin.<domain>` → the admin UI + portal-api) was already accidentally
  same-origin before this fix, which is why the platform-admin realm never showed Bug 1's symptom
  — a useful negative data point that helped localize the root cause.

## Test-strategy changes (the third ask)

1. **Bootstrap smoke test** (`apps/api/test/bootstrap.integration.spec.ts`) — calls
   `assertEditionCoverage()` against the same real `AppModule` every integration spec already
   builds, closing the gap where that assertion previously only ran at real production `bootstrap()`
   (which is exactly how the `@Edition` decorator bug from the 2026-08-19 first deploy was found —
   the hard way, in production, not in CI).
2. **`production-smoke.spec.ts`** — the new pattern for anything that can only be verified in the
   real topology: real browser, real TLS, real hostname split, and — per Bug 2's lesson —
   every state-mutating endpoint the flow could touch is explicitly blocked before the test's
   first live run, not discovered after one breaks something.
3. **Deploy gate** (Phase A action 4 of the follow-up plan) — wiring
   `production-smoke.spec.ts` into an actual deploy script, so this class of bug fails a deploy
   automatically instead of depending on a human noticing after the fact.

## What this doesn't fix

This retro and its immediate follow-ups close the three bugs found. It does not retroactively
audit every other screen/endpoint for the same *shape* of gap (topology-dependent bugs that unit
and in-process-harness tests structurally cannot see). That's an ongoing discipline the
`production-smoke.spec.ts` pattern establishes, not a one-time fix.
