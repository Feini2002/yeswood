## Why

The frontend has grown into two large shared files: `public/app.js` and `public/styles.css` are each over 10,000 lines, while several page and dashboard modules are already partially split. The next frontend work will be safer if the ongoing split has an explicit contract for module boundaries, validation, and phase-by-phase completion.

## What Changes

- Add a lightweight OpenSpec change for the current frontend monolith split.
- Introduce a `frontend-architecture` capability that defines the target static frontend module boundaries.
- Keep the existing plan in `docs/handbook/frontend-split-plan.md` as the human-readable implementation plan instead of duplicating it in full.
- Require phased verification so each migration step can be reviewed and tested before the next one starts.
- Preserve the current runtime strategy: native ES modules, static frontend assets, and no new runtime framework or bundler dependency.

## Capabilities

### New Capabilities
- `frontend-architecture`: Static frontend module boundaries, dependency direction, entrypoint responsibilities, test harness expectations, and split completion criteria.

### Modified Capabilities
- None.

## Impact

- Affected frontend files: `public/app.js`, `public/styles.css`, `public/dashboard/*.mjs`, and future `public/lib/`, `public/domain/`, `public/components/`, `public/pages/`, `public/styles/` modules.
- Affected tests: `tests/publicAppBehavior.test.mjs`, `tests/brand-ui.test.mjs`, `tests/homeDirectorMetrics.test.mjs`, and related frontend behavior tests.
- Affected documentation: `docs/handbook/frontend-split-plan.md`, `docs/handbook/development.md`, and `docs/STATUS.md`.
- No backend API contract change is introduced by this OpenSpec change.
- No new runtime dependency, frontend framework, or production build step is introduced.
