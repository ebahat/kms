# B2 Folder & Document Browser — UI Requirements & Stitch Design Brief

Date: 2026-08-03 · Status: DRAFT for review
Sources: `docs/ui/screens_spec_v01.md` §3–§4 (B2 row), `docs/requirements_v02.md` (PRD) §7–§8, `docs/security_requirements_v01.md` (sec)
Fidelity: **first of the 26 screens in `screens_spec_v01.md`**, chosen as the visual pilot because it carries the most distinct UI surface at once (tree nav, data table, status/permission badges, RTL, empty/loading/denied states) — later screens reuse whatever visual system comes out of this one.

Structure of this doc: §1–§6 are **fixed requirements** (structure, content, behavior, accessibility) — not up for Stitch to reinterpret. §7 is **deliberately open** — colors, typography, iconography, spacing, iconstyle are for Stitch/you to propose; this doc gives light steering, not a spec. §8 is a ready-to-paste prompt synthesizing the rest.

## 1. Screen identity

- **Who:** Tenant user, Knowledge Base edition, any role (read view is universal; action affordances vary by permission tier).
- **Where it sits:** Primary landing surface after login (`B1` app shell → default content pane). Reached via the shell's primary nav.
- **Priority:** P0 — this is the product's home screen.

## 2. Layout structure

Two-region layout on desktop/tablet, collapsing to single-region drill-down on mobile:

- **Left region — folder tree.** Nested hierarchy, up to 10 levels deep (PRD §8). Root level shows the tenant's top folders. Expand/collapse per node. Current folder highlighted.
- **Right region — document + subfolder list** for whichever folder is selected in the tree. A **breadcrumb trail** above the list shows the path from tenant root to current folder (breadcrumbs are themselves clickable to jump up the tree).
- **Mobile (< tablet breakpoint):** tree collapses entirely; the list becomes the whole screen, and the breadcrumb becomes the primary navigation (tapping a crumb goes up one level; tapping a subfolder row goes down one level) — a drill-down pattern, not a persistent side tree.

## 3. Content in the list (per PRD §8 metadata)

Each row is either a subfolder or a document. Columns/fields needed:

| Field | Applies to | Notes |
|---|---|---|
| Name | both | Untrusted display string — must render safely inside bidi isolation (Hebrew/English/numbers mixed in one name is the norm, not the exception) |
| Type icon | both | Visually distinguish folder vs. document; for documents, distinguish PDF/DOCX/JPG/PNG at a glance if feasible |
| Status chip | documents only | One of `queued` / `processing` / `indexed` / `failed` (PRD §8) — needs 4 visually distinct states, not just color-coded text (color alone fails WCAG for colorblind users) |
| Version | documents only | Current version number (e.g. "v3") |
| Size | documents only | Human-readable (KB/MB), LTR even inside RTL layout |
| Upload date | documents only | Localized (he-IL/en-US per active language), LTR |
| Creator | documents only | Uploader's display name |
| Permission-widening badge | folders only, conditional | Shown **only** on folders where `broaderThanParent: true` (see §5) |

## 4. Actions (gated by permission tier — PRD §7)

| Action | Minimum tier | Notes |
|---|---|---|
| View / open a folder | read | — |
| View / download a document | read | Download always via signed URL, never inline (sec §3.4/§4.4) |
| Upload a new file / new version | edit | — |
| Create a subfolder | edit | — |
| Move, rename, delete a document or folder | manage | Move shows a confirm dialog stating it re-applies the destination folder's permissions (PRD §8) |
| Change a folder's permission grants | manage | Not on this screen — links out to the admin permissions screen (C3) |

Actions the current user lacks permission for are simply **absent**, not shown-disabled-with-a-tooltip — this matches the "denied renders as not found" philosophy applied everywhere else in this product (sec §3.2), extended here to mean "you don't see controls for things you can't do."

## 5. The permission-widening badge (this session's requirements decision)

A folder whose effective grants reach a **wider audience** than its parent — e.g., a group added that the parent doesn't grant, or made public when its parent isn't — shows a visible badge in both the tree and the list. **Any** user who can read the folder sees it (not just admins) — the point is letting an ordinary user judge "is this a safe place to put something sensitive" without asking an admin.

- Badge needs a short label/icon distinct from the status chips (don't reuse that visual language — this is a *permission* signal, not a *processing* signal).
- Tapping/clicking the badge opens a small popover or panel listing the **groups** with access to this folder (never individual users — see the ADR-0005 rationale: naming a specific person would leak who has a personal grant to every other viewer).
- This is a read-time affordance available to any viewer, not an editing surface.

## 6. States (per `screens_spec_v01.md` §3.2, applied to this screen)

- **Loading:** skeleton rows for both tree and list — no spinner-on-white.
- **Empty folder:** first-use guidance ("upload your first file" / "create a subfolder"), not a bare empty table — differs from "folder has content you can't see," which is indistinguishable from "folder is genuinely empty" (§3.2's denied-state philosophy: no existence oracle).
- **Denied:** a folder the user can't read doesn't appear anywhere in the tree or a parent's listing — there is no "denied" visual state to design here, because the correct behavior is *absence*.
- **Processing status:** the 4 status chip states above are the async-status surface for this screen (PRD §8 status model); screen readers must announce status chip changes (WCAG 2.1 AA, §3.4).

## 7. Open — for Stitch/you to propose

Nothing below is fixed. Light steering only:

- **Tone:** enterprise SaaS, data-dense but not cluttered — this screen is closer to a file manager (Google Drive, Dropbox, SharePoint) than a marketing surface. Professional over playful.
- **Density:** moderately dense — tenant admins may browse folders with hundreds of documents; err toward compact rows over generous whitespace, but keep touch targets ≥44px on mobile.
- **Color/typography/iconography/dark-mode:** entirely open. If you want a starting palette or reference product to anchor Stitch's proposal, that's the one thing worth deciding before the first prompt — otherwise Stitch is proposing from nothing, same as an unconstrained blank page.
- **RTL as a first-class layout, not a mirrored afterthought:** worth stating explicitly to Stitch, since many design tools default to LTR-only thinking and RTL becomes a translation-day surprise.

## 8. Draft Stitch prompt (paste-ready, edit before use)

> Design a folder and document browser screen for an enterprise multi-tenant knowledge-base product (RTL Hebrew-first, also supports LTR English — treat RTL as the default layout direction, not a mirrored afterthought).
>
> Layout: a two-region view — a collapsible nested folder tree on one side, and a breadcrumb trail + document/subfolder list on the other. On mobile, the tree collapses and the breadcrumb becomes the primary way to navigate up/down, drill-down style.
>
> The list shows rows that are either a folder or a document. Document rows need: name (may contain mixed Hebrew/English/numbers), a status chip in one of four states (queued, processing, indexed, failed — each visually distinct, not color-only), version number, file size, upload date, and uploader name. Folder rows need: name, and — only on some folders — a small "broader access" badge distinct from the status chips, which opens a popover listing group names when tapped.
>
> Tone: professional enterprise SaaS, closer to a file manager (think Google Drive/Dropbox/SharePoint) than a marketing site. Data-dense but not cluttered.
>
> Show these states: populated list, empty-folder first-use state (not a bare empty table), and a loading skeleton state.
>
> [Insert your color/typography/brand direction here before sending.]

## Next steps

1. Owner reviews §1–§6 for anything factually off before this goes to Stitch (this doc should never need correcting *after* a design comes back).
2. Fill in the bracketed color/typography direction in §8, or ask Stitch to propose one from the tone description alone and iterate from there.
3. Bring the resulting visual back — I'll fold whatever comes out of it into a design-tokens pass for `apps/web` and the rest of the screen inventory reuses it, rather than every screen getting its own ad hoc Stitch prompt.
