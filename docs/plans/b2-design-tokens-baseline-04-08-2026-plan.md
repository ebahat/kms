# B2 design-tokens baseline — 2026-08-04

## Goal

Turn the Stitch-exported B2 (folder/document browser) static mockup into the real
Tailwind design-tokens baseline for `apps/web`, per Phase 2.6 next-step #1
(`unfry-sessions/2026-08-04-kms.md`). Scope confirmed with owner: **tokens +
shell restyle only** — not the full B2 screen with live data.

## Source

Stitch HTML template pasted by owner in this session (Material-3-style tokens:
custom color palette, spacing/radius scale, semantic type scale — `body-md`,
`headline-md`, etc. — RTL, Rubik + Courier Prime + Material Symbols Outlined).

## In scope

1. Install real Tailwind (v3, matches the template's JS-config format) — no CDN
   script tag, which is dev-only and unsuited to production.
2. `apps/web/tailwind.config.ts` — port the template's `colors`, `borderRadius`,
   `spacing`, `fontFamily`, `fontSize` tokens verbatim (they're already
   Material-3-derived and dir-agnostic).
3. Fonts: replace the Google Fonts `<link>` tags with `next/font/google`
   (Rubik incl. `hebrew` subset, Courier Prime) so fonts are self-hosted at
   build time, no runtime CDN request. Material Symbols Outlined via the
   `material-symbols` npm package (self-hosted CSS/woff2) instead of the
   Google Fonts icon CDN link, for the same reason.
4. Restyle the **existing real shell** — `app/layout.tsx` (root RTL html/body)
   and `app/home/page.tsx` (TopAppBar + nav drawer around the already-working
   session/edition/logout logic) — to match the template's visual language.
   Nav items reflect the real edition-gating already in `home/page.tsx`
   (KB vs OCR), not the template's fixed "מסמכים / תיקיות משותפות / ארכיון".
5. `globals.css`: add `@tailwind` layers, keep the existing `.auth-*` classes
   untouched (out of scope, login pages not touched this pass).

## Explicitly out of scope (per owner's scope choice)

- The actual document/folder list, upload button wiring, breadcrumbs — those
  need the Phase 2.4/2.5 APIs wired in, tracked as the next step after this.
- `/login`, `/login/totp`, `/tos-accept`, `/admin/*` visual treatment.
- Dark mode (template is light-only; Tailwind `darkMode: "class"` is ported
  but no dark palette is defined yet).

## Verification

- `pnpm --filter @kms/web build lint test:unit` green.
- Manual check via `pnpm --filter @kms/web dev` in a browser: RTL layout,
  Hebrew glyphs render (Rubik `hebrew` subset), Material Symbols icons render
  without a network request to Google Fonts, existing login→home flow still
  works (session fetch, edition-gated nav, logout).

## Status

- [ ] Tailwind + PostCSS + fonts + tokens
- [ ] Shell restyle (layout.tsx + home/page.tsx)
- [ ] Build/lint/test verification
- [ ] Manual browser check
