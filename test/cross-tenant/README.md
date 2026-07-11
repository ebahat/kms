# Cross-Tenant Isolation Suite

sec §10: "the single most important test asset in the codebase." Runs on every PR (Phase 0 CI gate).

## What it does

1. Auto-enumerates every registered route from the NestJS route table (`enumerate-routes.ts`) — new
   routes cannot silently skip the suite.
2. For each route, replays the request as a tenant-A session but with tenant-B resource identifiers
   (folder/document/conversation ids) and asserts **404**, never 403 (ADR-0001, sec §3.2).
3. A Smart-OCR variant replays user-A routes with user-B file ids, asserting the same (sec §3.6).
4. An edition variant replays KB-only routes under an OCR-only tenant and vice versa, asserting 404
   (ADR-0009 G2).

## Status

Harness skeleton only (Phase 0). Populated with live route fixtures starting with the first
repository/controller in Phase 1 — see `docs/plans/implementation-phases-11-07-2026-plan.md`.
