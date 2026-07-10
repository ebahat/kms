# ADR-NNNN: <Title — short noun phrase of the decision>

**Status:** Proposed | Accepted | Superseded by [ADR-NNNN](NNNN-title.md) | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** <who approved>
**Sources:** <PRD/security-spec sections this ADR implements, e.g. PRD §2, sec §3.1>

## Status

Current status and any lifecycle notes (e.g., accepted pending the benchmark gate defined in §Decision; superseded by ADR-NNNN on YYYY-MM-DD).

## Context

What forces are at play: the requirement(s) driving this decision, constraints that bound the option space, and the scale/security/compliance envelope it must fit. Cite the PRD (`PRD §x`) or security spec (`sec §x`) for every factual claim about requirements — an ADR reader should be able to trace each constraint back to its source. Note any settled decisions from `docs/requirements_review_v01.md` that this ADR must honor (or deliberately deviates from — flag deviations explicitly).

## Options Considered

At least two options, each with explicit trade-offs. If only one option is genuinely viable, keep the section and state why the alternatives are invalid rather than omitting them.

### Option A: <name>

Description, then:

- **Pros:** …
- **Cons:** …

### Option B: <name>

Description, then:

- **Pros:** …
- **Cons:** …

## Decision

The chosen option and the reasoning that selected it over the alternatives. Include concrete shape where the plan requires it (interface sketches, query shapes, index definitions, numeric thresholds) — a decision that can't be checked against code later is not a decision. Any pre-commitment gates (e.g., benchmark pass criteria) belong here with testable, numeric criteria — no "TBD".

## Consequences

- **Positive:** what becomes easier or safer.
- **Negative / accepted risks:** what becomes harder, costs incurred, limits accepted (state the bound, e.g. "holds to 10× MVP scale per PRD §13").
- **Follow-ups:** work this decision creates (tests, CI guards, future ADRs — future ADRs are listed in `docs/architecture/system-overview.md`, not opened in this pass).
