# Session security hardening: idle lock, remember-me, trusted devices

Status: IN PROGRESS. Started 2026-08-22. Scope confirmed via AskUserQuestion (2026-08-22): applies
identically to **both realms** (apps/api tenant + apps/portal-api platform-admin — the
platform-admin realm's existing "no self-service MFA recovery" stance stays, but idle-lock/
remember-me/trusted-devices are still built for it, not skipped); geo-IP uses a **self-hosted
MaxMind GeoLite2 database** (no user IP ever leaves this infrastructure); idle-lock is
**server-enforced** (a real security boundary, not just a client-side overlay).

## Origin

User request (verbatim), modeled on NIST SP 800-63B:
1. **Inactivity Timeout (Idle Lock):** after 2–4h idle, the session locks; unlocking needs only the
   password (not MFA).
2. **Absolute Session Expiration:** a "Remember Me" checkbox extends session lifetime to 14 days;
   otherwise the existing shorter lifetime applies. After absolute expiry, full login (password +
   MFA) is required.
3. **First Login & New Devices:** MFA is mandatory on first login and on any login from a new/
   unrecognized device, browser, or geographic location.
4. **Trusted Devices:** users can mark a device "Trusted" for 30 days; during that window, a
   standard login on that browser needs only the password.

Items 3 and 4 are two sides of one mechanism (a device is "new" precisely when it isn't a
currently-trusted device) and are designed together below as **C**.

## What exists today (apps/api + apps/portal-api, ADR-0004)

- `SessionRecord` (`libs/auth/src/session.ts`): `{userId, tenantId?, role, edition?,
  featureToggles?, createdAt, lastSeenAt, mfaVerified, tosVersion?}`.
- `REALM_CLOCKS: Record<Realm, {idleMs, absoluteMs}>` — **static, not per-session**:
  `tenant: {idleMs: 30min, absoluteMs: 12h}`, `platform: {idleMs: 15min, absoluteMs: 12h}`.
- `SessionService.get()` (`libs/auth/src/session.service.ts`): if `now - createdAt > absoluteMs`,
  calls `revoke()` and returns `null` (session is gone, not locked). The idle clock isn't
  separately enforced in `get()` today at all — TTL on the Redis key itself (`'PX', idleMs`) is
  what actually expires an idle session, by simply evicting the key.
- `SessionAuthGuard` / `PlatformSessionAuthGuard`: read the realm cookie, `sessions.get()`, `throw
  UnauthorizedException()` if missing, else `sessions.touch()` (refreshes the Redis TTL) and
  populate CLS scope.
- MFA is **already unconditionally mandatory on every login**, every time — there is currently no
  skip mechanism at all. Item 3's "mandatory MFA" is already true; items 3+4 together are really
  "build the first skip mechanism, and make sure it's narrow enough to still satisfy item 3."
- `@MfaExempt()` / `@TosExempt()` (`libs/contracts/src/mfa.ts`, `.../tos.ts`) + matching gate
  guards (`apps/api/src/common/mfa-gate.guard.ts`, `tos-gate.guard.ts`;
  `apps/portal-api/src/common/platform-mfa-gate.guard.ts`) — the established pattern for "this
  route is reachable from an interim, not-fully-authenticated state." **Idle-lock reuses this
  exact pattern** (a new `@LockExempt()` + `LockGateGuard`).
- `createResetToken()` / `isResetTokenValid()` (`libs/auth/src/password-reset.ts`) — 128-bit
  random token, SHA-256 hash persisted, `timingSafeEqual` compare. **Trusted-device tokens reuse
  this exact shape**, not a new one.
- `decideLoginHardening()` (`libs/auth/src/login-hardening.ts`) — progressive delay/CAPTCHA/
  lockout by failure count, already shared across both realms' login endpoints. **The new
  `/auth/unlock` endpoint reuses this too**, under its own rate-limit key, so a locked session's
  password field can't be brute-forced any more easily than login itself can.

## A — Idle lock (server-enforced)

### A.1 — Session shape

`SessionRecord` gains no new field — idle-lock state is **derived**, not stored: a session is
"locked" whenever `now - lastSeenAt > idleLockMs`. This mirrors how idle-expiry already sort of
works today (via Redis TTL), just made an explicit, checked comparison instead of relying on the
key having already evicted itself, and changed from "kill" to "lock."

`REALM_CLOCKS.idleMs` is retargeted from a *kill* threshold (30min/15min) to a *lock* threshold —
raised to **3 hours** for both realms (middle of the requested 2–4h range; a single shared constant
keeps tenant and platform-admin behavior identical per the realm-scope decision above). The old
short idle-kill behavior is gone: a session that goes idle for 3h **locks**, not dies; it only
truly dies at the (separate, longer) absolute-expiration clock from **B**.

### A.2 — Guard changes

`SessionAuthGuard`/`PlatformSessionAuthGuard`, after loading a valid `record`: instead of always
`touch()`-ing and proceeding, compute `idleMs = Date.now() - new Date(record.lastSeenAt).getTime()`.
If `idleMs > idleLockMs` **and** the route isn't `@LockExempt()`, throw a new `SessionLockedError`
→ mapped (via a small exception filter, mirroring `MulterExceptionFilter`'s shape) to `423 Locked`
with body `{error: 'SESSION_LOCKED'}`. The CLS scope is still populated in this case (the unlock
endpoint needs to know *who* — `scope.userId` — without re-parsing the cookie itself), just the
route handler never runs.

New decorator `@LockExempt()` (`libs/contracts/src/lock.ts`, `LOCK_EXEMPT_KEY`), new guard
`LockGateGuard` per realm (mirrors `MfaGateGuard`/`PlatformMfaGateGuard` exactly), applied to:
`POST /auth/unlock` (new, below) and `POST /auth/logout` (already exempt from MFA for the same
"must be able to escape" reason — locked must not mean trapped).

### A.3 — Unlock endpoint

`POST /auth/unlock` (both realms), `@LockExempt()`, body `{password}`:
1. Read `scope.userId` from CLS (populated by the guard above even while locked).
2. Look up the user/admin, `verifyPassword()` against their stored hash — same dummy-hash-on-miss
   timing-uniformity discipline `login()` already uses.
3. Rate-limited via `decideLoginHardening()` under a **separate** key (`unlock-fail:{userId}`, not
   `login-fail:{email}` — a locked-out *unlock* attempt must not also burn the user's *login*
   failure budget, and vice versa) — same delay/CAPTCHA/lockout thresholds.
4. On success: `sessions.touch()` (refreshes `lastSeenAt`, clearing the locked state — no new
   session, no re-running MFA, per the requirement). On failure: `401 {error:
   'INVALID_PASSWORD'}`.

### A.4 — Frontend

`apps/web/lib/api.ts`'s `request()` gains a `423` branch parallel to the existing `451` (ToS-gate)
one: redirect to a new blocking interstitial (`/locked`, `/admin/locked`) — a password-only form,
styled like `/login`'s card but with the tenant/admin identity already known (no email field). On
submit, `POST /auth/unlock`; on success, `router.back()` (or reload the page that triggered the
423) rather than a fresh login. Applies to both realms' API clients (`tenantApi`, `portalApi`).

## B — Remember Me / absolute session expiration

### B.1 — Contracts

`LoginRequestSchema` (`libs/contracts/src/auth-dto.ts` — shared by both `AuthController.login()`
and `PlatformAuthController.login()` already) gains `rememberMe: z.boolean().optional()`.

### B.2 — Session shape

`SessionRecord` gains `absoluteMs: number` — baked in **at creation time**, not read from the
static `REALM_CLOCKS` table anymore for the absolute-expiry check. `SessionService.create()`'s
signature doesn't need to change (the caller already builds the record they pass in); `login()` in
both controllers sets `absoluteMs: rememberMe ? FOURTEEN_DAYS_MS : REALM_CLOCKS[realm].absoluteMs`
before calling `sessions.create()`. `SessionService.get()`'s absolute-expiry check reads
`record.absoluteMs` instead of `REALM_CLOCKS[realm].absoluteMs`. `setSessionCookie()`
(`apps/api/src/auth/cookie.ts`, `apps/portal-api/src/auth/cookie.ts`) takes an explicit
`maxAgeMs` param instead of deriving it from the realm alone, so the browser-side cookie lifetime
actually matches.

**Not changed:** the *idle*-lock clock from A stays the same 3h regardless of remember-me — a
remembered device still locks after 3h of inactivity, it just doesn't need a full password+MFA
login to come back for up to 14 days.

## C — Mandatory MFA on new device/location + Trusted Devices (30 days)

### C.1 — Schema

`User` (`libs/data/src/models/user.schema.ts`) and `PlatformAdmin`
(`libs/data/src/models/platform-admin.schema.ts`) both gain:

```ts
@Prop({ type: [Object], default: [] })
trustedDevices!: { tokenHash: string; countryCode?: string; createdAt: Date; expiresAt: Date; lastUsedAt?: Date }[];
```

Same shape both realms — `countryCode` is the MaxMind-resolved country of the IP that *established*
trust, checked again at every subsequent login (see C.4).

### C.2 — Token minting (reuses password-reset's exact token shape)

New shared helper, `libs/auth/src/trusted-device.ts`: `createDeviceTrustToken()` →
`{rawToken, tokenHash, expiresAt}` (128-bit random, SHA-256 hash, 30-day TTL — literally
`createResetToken()`'s shape with a different TTL constant, factored to share the `sha256()`
helper rather than duplicating it). `isDeviceTrustValid(rawToken, entry)` mirrors
`isResetTokenValid()`.

### C.3 — Trusting a device (at TOTP verification time)

`TotpVerifyRequestSchema` (`libs/contracts/src/auth-dto.ts`) gains `trustDevice: z.boolean().optional()`.
In both `AuthController.verifyTotpCode()` / `PlatformAuthController.verifyTotpCode()`, after TOTP
succeeds: if `trustDevice`, mint a token, resolve the request IP's country via the new
`GeoIpProvider` (C.5), push `{tokenHash, countryCode, createdAt, expiresAt}` onto the user's
`trustedDevices` array (capped — evict the oldest if length > 10, so this can't grow unbounded),
and set a new cookie: `__Host-kms_device` (tenant) / `__Host-kms_padm_device` (platform),
`httpOnly, Secure, SameSite=Lax, maxAge: 30 days`, value = the **raw** token (never the hash).

### C.4 — Skipping MFA at login

In both `login()` handlers, **after password verifies, before returning `mfaRequired: true`**:
read the realm's device-trust cookie from the request; if present, hash it, look for a matching
`trustedDevices` entry with `expiresAt > now`; if found, resolve the *current* request IP's
country and compare to the entry's stored `countryCode`. Only if the token matches **and** the
country matches: create the full session directly (`mfaVerified: true`) and return `{mfaRequired:
false}` — skip the TOTP step entirely. Any mismatch (no cookie, expired/revoked/unknown token, or
different country) falls through to today's unconditional `mfaRequired: true` path — this is
exactly what makes "new device" and "unrecognized location" both force MFA, as the same one
fallthrough, not two separate checks.

**Explicit safety invariant** (stated because it's the thing most likely to get quietly violated
during implementation, same discipline as the C2 subdomain-routing plan's own invariant call-out):
a trusted-device token **only ever skips the MFA step**. It is never sufficient on its own — the
password check always happens first and always happens every time, trusted device or not. A
stolen device-trust cookie without the password is worthless.

### C.5 — GeoIpProvider (self-hosted MaxMind GeoLite2)

New `libs/auth/src/geo-ip.ts`: `interface GeoIpProvider { countryFor(ip: string): string | undefined }`.
Binding: `MaxMindGeoIpProvider`, backed by the `maxmind` npm package reading a local
`GeoLite2-Country.mmdb` file path from an env var (`GEOIP_DB_PATH`). `FakeGeoIpProvider` (constant
or lookup-table return) for tests/dev, matching every other provider interface in this codebase
(`StorageProvider`, `NotificationProvider`, `CaptchaVerifier` — Fake-first, real binding only where
configured). If `GEOIP_DB_PATH` is unset, the "unrecognized location" check is skipped entirely
(returns `undefined` for every IP, so C.4's country comparison never blocks a trusted-device match
on a missing DB) rather than hard-failing login — **not** a silent security regression, since the
device-*token* check still gates everything; it just means location-mismatch detection is a no-op
until an operator provisions the DB, which is a real, flagged operational dependency below.

**Operational dependency, owner-side, not something this plan can execute:** MaxMind now requires
a free account + license key to download GeoLite2 even under their no-cost tier, and the `.mmdb`
file needs periodic re-download (MaxMind ships updates roughly weekly; stale data degrades
accuracy, not safety, since a mismatch only ever *adds* an MFA prompt, never removes one). For
`deploy/docker-compose.yml`: bake the DB into the `api`/`portal-api` images at build time (simplest
— accept it goes stale between deploys) or mount it as a volume updated by a small `cron`
container — **left as an explicit open question below**, not decided here, since it's an infra/ops
call outside this plan's core scope.

### C.6 — Revocation

Deactivating a tenant user (`TenantUsersAdminController.deactivate()`) already calls
`sessions.revokeAll('tenant', ...)`; it now **also** clears `trustedDevices: []` on that user —
otherwise a deactivated-then-reactivated account would silently keep skipping MFA from an old
trusted device. No equivalent exists for platform admins today (no deactivate endpoint) — flagged,
not built, since it's out of this plan's scope.

No "manage my trusted devices" self-service UI in this pass (list/revoke individual entries) —
the `trustedDevices` array is capped at 10 and expires on its own; a full management screen is a
reasonable v1.1-style follow-up, not blocking this plan's core requirement.

## Testing strategy

- Unit: `libs/auth`'s new `trusted-device.ts` (mirrors `password-reset.spec.ts` almost exactly),
  `geo-ip.ts` (Fake + the MaxMind binding's parsing, mocked db reads), `LockGateGuard` (mirrors
  `mfa-gate.guard.spec.ts`), updated `SessionService.spec.ts` for per-record `absoluteMs`.
  `AuthController`/`PlatformAuthController` specs extended: remember-me sets the longer
  `absoluteMs`; TOTP-with-trustDevice mints a cookie; login with a valid/matching device cookie
  skips MFA; login with a valid device cookie but a *different* resolved country does not.
- Integration (`apps/api/test/`, `apps/portal-api/test/` — the harness built earlier today for the
  Phase C follow-up): a full idle-lock-then-unlock round trip against real Redis-mock TTL/CLS
  timing (the exact class of bug the CLS/backstop fix caught today argues for **not** trusting
  unit-mocked coverage alone here either); a full trust-device-then-skip-MFA round trip.
- Live verification (browser): same discipline as today's Phase C1/C1-follow-up work — actually
  drive the idle-lock overlay, an unlock, a remember-me login surviving past the old 12h mark (or
  a shortened test constant), and a trusted-device second login skipping the TOTP screen.

## Open questions

1. **Idle-lock threshold exact value** — 3h chosen as the range's midpoint; flag if a specific
   value (2h vs 4h) matters for a real compliance requirement rather than an arbitrary pick.
2. **GeoLite2 deployment mechanism** (C.5) — bake into the image vs. a volume + refresh cron — not
   decided, doesn't block writing the code against the `GeoIpProvider` interface either way.
3. **Trusted-device cap (10) and no self-service revoke UI** — reasonable defaults, not explicitly
   requested; revisit if a real user needs to see/revoke their own trusted devices sooner than a
   later phase.
4. **Platform-admin deactivate endpoint doesn't exist**, so C.6's revoke-on-deactivate has no
   platform-realm equivalent to hook into — noted, not a gap this plan creates or is expected to
   close.
