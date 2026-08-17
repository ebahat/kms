# Draft: system-wide external design-tool prompt (P0 screens, groups B–E)

Status: DRAFT, not yet sent. Companion to `docs/ui/b2-folder-browser-stitch-brief-v01.md` (the B2
pilot this reuses) and `docs/plans/ui-proposals/DESIGN.md` (the locked token system this must not
reinvent).

---

> You are extending an existing design system, not creating a new one. Below is the complete token
> system already in production use — reuse it exactly (same color names, type scale, spacing,
> radii). Do not propose alternatives, new colors, or a different type scale. If a screen needs
> something the system doesn't cover, flag it as a question rather than inventing a token.
>
> [PASTE THE FULL YAML FRONT-MATTER FROM docs/plans/ui-proposals/DESIGN.md HERE — colors,
> typography, rounded, spacing — verbatim]
>
> Design language recap: Corporate/Modern, high information density over decoration, RTL-first
> (Hebrew default, English secondary — not a mirrored afterthought), Rubik typeface, tonal layering
> instead of heavy shadows, WCAG 2.1 AA contrast throughout.
>
> ---
>
> This is a multi-tenant enterprise knowledge-base product (RAG chat + document management) for the
> Israeli market. You're generating the next batch of screens for an already-partially-built product
> — the folder/document browser (equivalent to what you'd call "Files") is done and established this
> visual system; these screens must look like siblings of it, not a new product.
>
> ## Global rules that apply to every screen below
>
> - RTL is the default layout direction. Navigation, chevrons, and progress indicators mirror in
>   RTL; media controls and document thumbnails do not. Numbers, dates, and file sizes stay LTR
>   inside RTL layouts. Mixed Hebrew/English content in the same string (filenames, names) is the
>   norm — show it rendering correctly, not as an edge case.
> - Every screen needs 4 states shown: loading (skeleton, never a bare spinner), empty (first-use
>   guidance with a clear next action, never a blank table), error (a safe, non-technical message
>   with a retry action), and — where relevant — a rate-limited/budget-exhausted state with
>   non-scary copy and a clear next step.
> - A resource the user can't access never shows a "denied" screen — it simply doesn't appear in
>   lists/nav, exactly like a 404. Don't design a denied state; design the absence.
> - Full keyboard operability and visible focus rings on every interactive element. Status changes
>   that happen asynchronously (upload progress, processing status, streaming text) need a visible
>   design for how a screen-reader user would perceive the same update — annotate this even though
>   you can't literally implement ARIA live regions in a static mock.
> - Downloads are never inline — every "download" action implies a short-lived link the browser
>   treats as an attachment, not an in-app viewer. Don't design an in-app PDF/DOCX viewer.
>
> ## Screens to generate (P0, in this order — later screens should visually reuse components
> introduced by earlier ones rather than reinventing them)
>
> **B1 — App shell.** Tenant name + logo in the header, primary nav (document browser / chat /
> favorites / processing queue / admin section if the user is an admin), a language switch (עברית /
> English), and a storage-quota banner that appears only at 80%+ usage (warning tone) and 95%+
> (urgent tone) for tenant admins. This is the frame every other screen lives inside.
>
> **B3 — Document detail & versions.** Metadata header, a processing-status area that shows an
> actionable error with a retry button when status is `failed` (never a raw error string), and a
> version history list — each version downloadable, with a "restore this version" action for users
> with edit permission (restoring creates a new latest version, doesn't overwrite history — the UI
> should make that non-destructive framing clear).
>
> **B4 — Upload.** Drag-and-drop zone + file picker, multi-file, with per-file inline validation
> (file type badge for PDF/DOCX/JPG/PNG, a 50MB size cap, and rejection messaging for
> corrupt/password-protected files). For scanned/image files, an OCR engine choice (Classic vs.
> Advanced, Advanced shown with a cost/token hint) — this choice should be visually absent, not
> disabled, when the screen is rendered in "Classic-only enforced" mode. Show a quota-insufficient
> state that fires before any file starts processing.
>
> **B5 — Processing queue.** A live-updating list, one row per in-flight document, each showing its
> current stage and — for the tenant overall — quota consumed vs. remaining this month. Failed rows
> show a sanitized reason and a retry action.
>
> **B6 — Chat.** A conversation list on one side (view/resume/delete past conversations) and a
> streaming chat pane on the other. Answers include inline citation chips that look clickable and
> distinct from body text. Design the "not found in your accessible documents" response as a
> first-class, calm answer state — not an error banner. Also show: rate-limited state (a soft
> "you've reached this hour's limit" message) and budget-exhausted state that points the user toward
> search (B7) as a still-working alternative. This is the highest-risk screen for RTL/LTR mixing —
> show a Hebrew question with an answer that mixes Hebrew prose, an English filename citation, and a
> number, all in one bubble.
>
> **B7 — Search results.** A simpler standalone hybrid-search results list — each result is a text
> snippet + source document + page number, with exact-term matches visually distinguished from
> semantic matches. This is also what B6 degrades to when chat budget is exhausted, so it should
> feel like a natural sibling of the chat pane, not a different product.
>
> **C1 — Users (tenant admin).** A user table with create/deactivate/reactivate actions, an
> MFA-reset action, and a CSV/Excel bulk-import flow that shows per-row validation results with a
> downloadable error report for the rows that failed.
>
> **C2 — Groups.** Simple CRUD list for groups plus a membership editor (add/remove users from a
> group).
>
> **C3 — Folder permissions.** The most structurally complex screen in the set: a permission editor
> showing per-folder read/edit grants to users and groups, with inherited-vs-overridden state shown
> explicitly per subfolder (not just "has access" — show *why*), and an "effective permission
> preview" tool where an admin picks a specific user and sees a plain-language answer to "why can
> this person see this folder?" There is no "pending changes" state — every change is described as
> taking effect immediately, so don't design a save/publish step.
>
> **C4 — Recycle bin.** A deleted-items list showing remaining retention days before permanent
> deletion, with restore and "purge now" actions. Purge is the most destructive action in the
> product — design its confirmation as a typed-confirmation dialog (user types the item name or
> "DELETE" to proceed), not a simple Yes/No.
>
> **C6 — Audit log.** A read-only, filterable, exportable event table. Include a raw query-text
> column (this is the one place in the product where that's shown — analytics screens elsewhere
> only show anonymized aggregates, don't carry that raw-text pattern anywhere else).
>
> **D1 — OCR standalone: personal directory.** A flat file list (no folders, no sharing — this is a
> single-user product surface), where every row shows a countdown to automatic deletion 7 days after
> upload. The retention policy should be visible both at upload time and persistently on this list,
> not just in fine print once.
>
> ## Cross-screen flows to keep visually consistent (don't design these as separate storyboards —
> just make sure the individual screens above compose into them coherently)
>
> - Upload (B4) → appears in the queue (B5) → status chip updates on the document once
>   indexed → now shows up in chat citations (B6) and search (B7).
> - A permission change in C3 should read, at a glance, like the same "who can see this" mental
>   model that the permission-widening badge on the document browser already uses — reuse that
>   badge/chip visual language here rather than inventing a second one.
>
> ## Output format
>
> Static HTML/Tailwind mockups, one file per screen, same structure as the existing document-browser
> mockups (RTL `<html dir="rtl">`, the token system as a Tailwind config block, Rubik + Material
> Symbols Outlined). Populated with realistic Hebrew sample data (real-looking tenant/user/document
> names, not "Lorem ipsum" or "תיקייה 1").
