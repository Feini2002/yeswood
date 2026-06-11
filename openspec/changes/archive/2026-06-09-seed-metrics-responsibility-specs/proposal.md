## Why

Dashboard metrics and personnel responsibility routing are the highest-risk business semantics in P1. They determine what counts in each profile, how owners are scoped, and which projects enter responsibility or review channels.

## What Changes

- Add OpenSpec baselines for `dashboard-metrics` and `personnel-responsibility-routing`.
- Capture the core invariants already documented in `docs/contracts/dashboard-metrics.md` and `docs/contracts/personnel-and-responsibility-routing.md`.
- Keep this as a contract seeding change with no application behavior changes.

## Capabilities

### New Capabilities
- `dashboard-metrics`: Profile scope, KPI field semantics, store tier/discipline orthogonality, ownerMonthly scope, open-delay rules, and monthlyOps date semantics.
- `personnel-responsibility-routing`: Local personnel authority, stable responsibility identities, dual-discipline routing, team membership boundaries, and review-channel handling.

### Modified Capabilities
- None.

## Impact

- Adds baseline OpenSpec specs for metric and responsibility semantics after archive.
- References existing tests under `tests/metrics/`, `tests/teamMetrics.test.mjs`, `tests/personnel*.test.mjs`, and `tests/responsibilityRepository.test.mjs`.
- Does not change API payloads, frontend rendering, personnel data, or metric calculations.
