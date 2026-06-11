## Context

The current static frontend is operational but concentrated in two very large files: `public/app.js` and `public/styles.css`, both above 10,000 lines. Some chart and dashboard pieces already live under `public/dashboard/*.mjs`, and the current split plan is documented in `docs/handbook/frontend-split-plan.md`.

This change turns that plan into an OpenSpec-controlled migration. It does not replace the existing handbook plan; it establishes the architectural guardrails and verification gates that each split phase must satisfy.

## Goals / Non-Goals

**Goals:**
- Reduce frontend change risk by moving from one large entrypoint to explicit `lib`, `domain`, `components`, `pages`, and `styles` boundaries.
- Keep the split incremental so each phase can be tested and reviewed independently.
- Preserve the current static deployment model and native ES module runtime.
- Create an explicit frontend test harness so behavior tests remain stable while functions move between files.
- Keep this OpenSpec change limited to frontend structure, not business-rule migration.

**Non-Goals:**
- Do not introduce React, Vue, Svelte, Vite, Webpack, or a required production build step.
- Do not redesign the UI or change frontend copy as part of the split.
- Do not change backend API contracts, data authority rules, dashboard metric semantics, personnel routing, or DingTalk sync behavior.
- Do not migrate existing `docs/contracts/` business contracts into OpenSpec in this change.

## Decisions

### Decision 1: Use native ES modules and phased strangler migration

Move code out of `public/app.js` gradually into native browser modules. Keep `app.js` as the orchestrator during and after the migration.

Alternatives considered:
- Full framework rewrite: rejected because it would mix structural migration with UI/runtime changes.
- Bundler-first migration: deferred because the current static frontend can support native ES modules and the project intentionally keeps runtime dependencies low.

### Decision 2: Enforce one-way dependency layers

Use the dependency direction from the handbook plan:

```text
pages -> components -> domain -> lib
pages -> dashboard
```

Page modules must not import each other. Domain modules must not import UI modules or use DOM globals.

Alternatives considered:
- Feature folders with mixed UI/domain/helpers: rejected for now because the immediate problem is separating logic from DOM and entrypoint orchestration.
- Shared global helpers from every layer: rejected because it recreates hidden coupling under a different file name.

### Decision 3: Introduce a test harness before major extraction

Create `public/test-harness.mjs` early and move behavior tests to import or evaluate stable exports from that harness. This avoids repeatedly rewriting tests around the current large `app.js` body.

Alternatives considered:
- Keep VM-concatenating `public/app.js`: rejected because it becomes brittle once code moves across modules.
- Move immediately to browser-only tests: deferred because current Node tests are fast and already cover many frontend behaviors.

### Decision 4: Split CSS along the same ownership boundaries

Create `public/styles/app.css` as the stylesheet entrypoint, with shared tokens/base/component styles and page-specific files underneath `public/styles/pages/`.

Alternatives considered:
- Leave CSS monolithic while JS is split: rejected because later page work would still collide in one 10,000-line stylesheet.
- CSS modules or scoped build tooling: deferred because it would require a build step not needed for this migration.

## Risks / Trade-offs

- Circular dependencies between extracted modules -> Mitigation: enforce the dependency direction in the spec and keep `domain` DOM-free.
- Test harness drift -> Mitigation: update `public/test-harness.mjs` in the same phase as any moved behavior-tested function.
- CSS regressions from moving selectors -> Mitigation: split styles page by page and run `brand-ui` plus focused manual desktop checks.
- Scope creep into UI redesign or business rules -> Mitigation: treat intentional behavior changes as separate OpenSpec changes.
- Larger number of browser requests during development -> Mitigation: acceptable for the current static intranet app; bundling remains optional future work.

## Migration Plan

1. Phase 0: add directories, add `public/test-harness.mjs`, adjust frontend behavior tests, and record line-count baselines.
2. Phase 1: extract `lib` helpers for API, formatting, shared state, DOM references, and routing.
3. Phase 2: extract DOM-independent `domain` logic for workflow, reminders, project display, personnel, and metrics display.
4. Phase 3: extract reusable components such as filters, drill modal, project workbench, detail modal, and sync controls.
5. Phase 4: extract page modules from least coupled to most coupled: rules, developer docs, details, profile pages, owner review, teams, overview.
6. Phase 5: finish CSS split, remove dead code, and update development/status documentation.

Each phase must pass the targeted frontend tests listed in the spec before the next phase starts. Full `node --test` should pass at major checkpoints and at completion.

Rollback strategy: because this is a structural migration, rollback should be phase-level. Revert the specific module extraction phase and keep prior completed phases intact when possible.

## Open Questions

- Whether to add an automated import-boundary test after the first few modules exist.
- Whether `public/dashboard/` should remain as a dashboard component folder long term or be gradually folded under `public/components/`.
- Whether Vite should be introduced later as a dev-only tool if native module file count becomes cumbersome.
