## Context

The current system is a local project data middle platform: DingTalk AI Table is the external import source, local SQLite is the final project data source, and the browser frontend only talks to this system's backend. These boundaries are documented in `docs/contracts/`, but OpenSpec currently has only the frontend architecture baseline.

This change seeds the first business-critical OpenSpec baselines. The specs intentionally stay compact: they describe enforceable invariants and representative scenarios, while the Markdown contracts keep longer business explanations and maintenance notes.

## Goals / Non-Goals

**Goals:**
- Establish baseline OpenSpec capabilities for security, data authority, and field mapping.
- Make future local editing and diff-review work depend on explicit contract boundaries.
- Preserve current behavior and avoid implementation churn.

**Non-Goals:**
- Do not migrate all contract text into OpenSpec.
- Do not change backend sync behavior, field resolver behavior, or frontend display behavior.
- Do not add CI, npm dependencies, or new runtime services.

## Decisions

### Decision 1: Seed baselines through a no-behavior-change OpenSpec change

The specs are created as a normal OpenSpec change and archived after validation. This keeps history visible while producing baseline specs.

### Decision 2: Keep specs narrower than Markdown contracts

Specs capture the testable SHALL/MUST boundaries. The longer Markdown documents remain the place for rationale, business wording, and maintenance procedures.

### Decision 3: Split safety, authority, and mapping into separate capabilities

Security, data authority, and field mapping often change together, but they fail in different ways and have different tests. Separate specs make future deltas smaller and easier to review.

## Risks / Trade-offs

- Specs may duplicate some contract wording -> Mitigation: keep each requirement short and link future work to docs for nuance.
- Future developers may update Markdown but forget OpenSpec -> Mitigation: a later drift test checks required baseline specs exist and use normative scenarios.
- Baselines may be too coarse for future P2 local editing -> Mitigation: local editing and source diff review get separate future changes.
