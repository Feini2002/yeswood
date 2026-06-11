## Why

Hard decoration deadlines drive reminders, fallback delay judgment, efficiency analysis, and rule-page explanations. They already have executable rules and tests, but they need an OpenSpec baseline before P1/P2 changes add review workflows and KPI calibration.

## What Changes

- Add the `hard-decoration-deadlines` OpenSpec capability.
- Capture the current effective hard decoration deadline invariants from `docs/rules/operational-rulebook.md`.
- Preserve soft decoration and staging rules as future work because they remain pending in the rulebook.
- Do not change executable rules, calendar data, frontend behavior, or tests.

## Capabilities

### New Capabilities
- `hard-decoration-deadlines`: China-workday deadline calculation, form-result priority, system fallback deadlines, floor-plan delay versus efficiency, construction drawing timeout semantics, and rulebook/executable synchronization.

### Modified Capabilities
- None.

## Impact

- Adds a baseline spec under `openspec/specs/hard-decoration-deadlines/spec.md` after archive.
- References existing executable rules in `src/backend/hardDecorationDeadlineRules.mjs` and calendar data under `data/rules/`.
- References existing tests in `tests/hardDecorationDeadlineRules.test.mjs`, `tests/rulesDocs.test.mjs`, `tests/publicAppBehavior.test.mjs`, and `tests/brand-ui.test.mjs`.
