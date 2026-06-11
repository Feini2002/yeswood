## Context

The system now has several dashboard views: department, direct, franchise, ownerMonthly/team, project details, and owner review. It also has local personnel master data and responsibility identities that intentionally differ from raw DingTalk project participation fields.

The existing Markdown contracts explain the business reasoning. This OpenSpec change creates baseline requirements for the behavior that must stay stable as P1/P2 work adds local edits and diff review.

## Goals / Non-Goals

**Goals:**
- Preserve the distinction between priority status, workflow stage, scheme status, and management dates.
- Preserve scope semantics for dashboard profiles and ownerMonthly views.
- Preserve stable responsibility identity routing and review-channel behavior.

**Non-Goals:**
- Do not rewrite metric implementations.
- Do not change personnel data or default teams.
- Do not introduce new dashboard views.

## Decisions

### Decision 1: Keep metric semantics and responsibility routing as separate specs

Metrics consume responsibility routing but evolve independently. Separate specs keep future changes small and make it clear whether a delta changes metric predicates or identity resolution.

### Decision 2: Specify negative boundaries explicitly

Many past risks came from using one field as a proxy for another. The specs explicitly say what MUST NOT be inferred: workflow from priority, discipline from tier, team membership from project collaboration, and explicit slots from ambiguous total owner fields.

## Risks / Trade-offs

- Some requirements restate existing tests -> Mitigation: the baseline documents why those tests matter and becomes the change-review anchor.
- Future metric additions may not fit current names -> Mitigation: add new requirements through OpenSpec deltas rather than widening old terms silently.
