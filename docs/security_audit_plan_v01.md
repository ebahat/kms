# Security Audit Plan — v01

Date: 2026-07-10 · Status: DRAFT for review
Sources: `docs/security_requirements_v01.md` (sec), `docs/test_plan_v01.md` (test plan), `docs/requirements_v02.md` (PRD), ADRs 0001–0003
Scope split: the **test plan §3** owns the automated security *tests* that run in CI (cross-tenant suite, malicious-document corpus, injection batteries…). This document owns the **audit program**: recurring human+tool reviews, their tooling, cadence, and evidence trail. Together they discharge sec §10 and the compliance targets (SOC 2 Type II, Israeli PPL + 2017 Data Security Regulations — PRD §3).

## 1. Audit layers and cadence

| Layer | What | Cadence | Blocking? |
|---|---|---|---|
| L1 — CI gates | SAST, dependency/SCA, secrets, IaC, container scans + the test-plan §3 suites | Every PR | Yes (high/critical) |
| L2 — Change review | AI-assisted security review of each feature diff | Every feature PR (3+ files) | Yes — findings triaged before merge |
| L3 — Periodic deep audit | Full-repo audit, threat-model refresh, config review (Atlas/GCP), DAST, LLM red-team | Quarterly during build; pre-GA mandatory | Release-blocking pre-GA |
| L4 — External | Penetration test; SOC 2 Type II audit; 2017-regs risk survey | Pre-GA, then ≤ every 18 months (sec §1, §10) | GA-blocking |

## 2. L1 — CI security gates (tooling)

Per the global working rule (one security mechanism per scan class) and "Snyk at inception":

| Gate | Tool | Invocation | Fail threshold |
|---|---|---|---|
| SAST (TS/JS) | Snyk Code | `snyk_code_scan` (MCP) locally on newly generated code; `snyk code test` in CI | High+ |
| Dependencies | Snyk Open Source | `snyk_sca_scan` (MCP) / `snyk test` in CI; `snyk_package_health_check` before adopting a new package | High+ (upgradable), Critical (always) |
| Secrets | gitleaks | `gitleaks detect` pre-commit + CI | Any finding |
| IaC (Terraform, ADR-0007) | Snyk IaC | `snyk_iac_scan` (MCP) / `snyk iac test` in CI | High+ |
| Container images | Snyk Container | `snyk_container_scan` (MCP) / CI on the three worker images + API image | High+ |
| AI bill of materials | Snyk AIBOM | `snyk_aibom` — regenerate when a model/provider/prompt dependency changes (supports sec §9 sub-processor register) | Informational |
| Isolation proof | Cross-tenant suite | test plan §3.1 — Jest, every PR | Any failure |

Workflow on findings: fix using the scan's context → rescan until clean → if a fix is deferred, record an accepted-risk entry (owner, expiry date) in `docs/security/risk-register.md` (create on first use). No silent suppressions; Snyk ignore rules require a register entry.

## 3. L2 — AI-assisted change review (skills/agents to use)

Run on every feature-sized diff, after tests pass, before merge (global Rule 4 pipeline order):

1. **`snyk_code_scan`** on the changed packages — the primary mechanism for TypeScript (supported language), per Rule 4 step 3.
2. **`/security-review`** (built-in Claude Code skill) on the diff — catches logic-level issues SAST misses: missing tenant scope, authz gaps, mass assignment, SSRF.
3. For security-critical paths (anything touching `ScopedRepository`, auth, signed URLs, retrieval query builder, chat renderer — the CODEOWNERS list from ADR-0009 when it lands): additionally run the **`candlekeep-cloud:security-reviewer`** agent (web-app security book: BOLA, CSRF, headers) or **`oh-my-claudecode:security-reviewer`** (OWASP Top 10, secrets, unsafe patterns). One of the two, not both — pick candlekeep when the diff is API-surface-heavy, OMC otherwise.
4. Reviewer disposition recorded in the PR; unresolved highs block merge.

## 4. L3 — Periodic deep audit (quarterly + pre-GA)

Checklist per run; each item names its mechanism:

| # | Audit area | Requirement source | How to run |
|---|---|---|---|
| 1 | Full-repo security audit | sec §10 | **`/oc-security-audit`** skill over the repo + full Snyk scans (code, SCA, IaC, container) |
| 2 | Tenant-isolation architecture drift | sec §3; ADR-0001/0002 | Manual review: every new collection carries `tenantId` + scoped-repo access; retrieval queries still built by the single audited builder; grep for raw `mongoose`/`InjectModel` outside repositories (the ADR-0001 lint rule's coverage itself is audited) |
| 3 | Threat-model refresh | sec §0 | Diff new features against the sec threat model; new surfaces get entries + tests; LLM threats reviewed against current OWASP LLM Top 10 |
| 4 | Atlas configuration | sec §6 | Review: Private Service Connect only, no public IP allowlist, TLS enforced, backup schedule, DB users least-privilege, audit of Atlas project access |
| 5 | GCP configuration | sec §6; ADR-0007 | Review IAM bindings (least privilege, no user-owned service-account keys), worker-pool egress policies (parse pool: canary-URL egress test from test plan §3.3 re-run against prod config), Cloud Armor rules, Secret Manager rotation, signed-URL key age |
| 6 | DAST | sec §10 | OWASP ZAP baseline scan (`zaproxy/zap-baseline.py` container) against staging, authenticated profile; triage alerts vs headers/CSRF/cookie expectations in test plan §3.4–§3.5 |
| 7 | LLM red-team | sec §5 | Full adversarial eval suite (test plan §4.6) + a manual exploratory session (Hebrew + English) attempting new attack classes; every success becomes a permanent dataset case (test plan §4.7) |
| 8 | Audit-trail & deletion verification | sec §7.3, §8.1 | Run deletion-verification job against a sacrificial tenant; verify hash-chain of exported audit log; confirm §12 event-class coverage matrix still green |
| 9 | Access & sessions | sec §2 | Review platform-admin account list, MFA enrollment 100%, session-config values unchanged (idle/absolute), dependency check on Argon2 params vs current OWASP guidance |
| 10 | Sub-processor / DPA register | sec §9 | Verify zero-retention DPA still in force for every AI/OCR/email provider in the AIBOM; regenerate `snyk_aibom` |

Output artifact per run: `docs/security/audit-YYYY-MM.md` — findings, severities, owners, fix-by dates; feeds the SOC 2 evidence folder.

## 5. L4 — External engagements

- **Penetration test**: pre-GA, then ≤ every 18 months (sec §1). Scope must explicitly include: cross-tenant/cross-user isolation (grey-box, two tenant accounts + one OCR-E pair supplied), LLM surfaces (prompt injection, exfiltration-via-markdown, citation forgery), signed-URL abuse, and the platform-admin realm. Findings → risk register + permanent eval/test cases.
- **SOC 2 Type II**: select auditor during build phase; the L1 CI evidence, L3 audit reports, and access-review records are the control evidence. Start the observation window only after L3 has run clean twice.
- **Israeli 2017 regs**: the regs' periodic risk-survey obligation is satisfied by the L3 cadence + pentest; document the mapping once in `docs/security/compliance-mapping.md` (build-phase task).

## 6. Standing rules

- New attack class discovered anywhere (CI, audit, pentest, production) ⇒ permanent regression: eval dataset case (LLM) or fixture (deterministic) — never a one-off fix.
- Audit evidence is append-only and dated; reports live under `docs/security/` and are never edited after sign-off (errata go in the next report).
- Any threshold or scope change to this plan is a reviewed edit here, mirroring the test plan's no-silent-changes rule.

## 7. Open items

1. Choose ZAP authenticated-scan mechanics (session-cookie handoff) when staging exists.
2. CODEOWNERS security-path list — arrives with ADR-0009; §3.3 above depends on it.
3. SOC 2 auditor selection + evidence-folder layout.
4. Confirm Snyk org/project wiring in CI (`snyk_auth` locally; service token in CI).
