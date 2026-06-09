## 1. Phase 0 - Preparation

- [x] 1.1 Create `public/lib/`, `public/domain/`, `public/components/`, `public/pages/`, and `public/styles/` directories with minimal ownership notes if needed.
- [x] 1.2 Add `public/test-harness.mjs` as the explicit frontend behavior test entrypoint.
- [x] 1.3 Update `tests/publicAppBehavior.test.mjs` to use the harness without changing tested behavior.
- [x] 1.4 Record current `public/app.js` and `public/styles.css` line-count baselines in the relevant task notes or status document.
- [x] 1.5 Run `node --test tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs tests/homeDirectorMetrics.test.mjs`.

## 2. Phase 1 - Extract Lib Layer

- [x] 2.1 Move API endpoint constants and `fetchJson`-style helpers into `public/lib/api.mjs`.
- [x] 2.2 Move formatting helpers such as HTML escaping, date formatting, and display fallback helpers into `public/lib/format.mjs`.
- [x] 2.3 Move shared application state initialization into `public/lib/state.mjs`.
- [x] 2.4 Move DOM reference registration and shared DOM utilities into `public/lib/dom.mjs`.
- [x] 2.5 Move hash parsing, page switching, and navigation helpers into `public/lib/router.mjs`.
- [x] 2.6 Update `public/app.js` to import the lib layer while preserving current runtime behavior.
- [x] 2.7 Update `public/test-harness.mjs` exports for any behavior-tested functions moved in this phase.
- [x] 2.8 Run the targeted frontend tests before starting Phase 2.

## 3. Phase 2 - Extract Domain Layer

- [x] 3.1 Move project workflow and lifecycle classification logic into `public/domain/project-workflow.mjs`.
- [x] 3.2 Move project deadline, reminder, next-action, and field-gap logic into `public/domain/project-reminders.mjs`.
- [x] 3.3 Move project display and assignment-gap helpers into `public/domain/project-display.mjs`.
- [x] 3.4 Move personnel parsing and architecture display helpers into `public/domain/personnel.mjs`.
- [x] 3.5 Move KPI display, tier, drill-filter, and profile formatting helpers into `public/domain/metrics-display.mjs`.
- [x] 3.6 Confirm domain modules do not depend on `document`, `window`, `public/pages/`, or `public/components/`.
- [x] 3.7 Update `public/test-harness.mjs` exports for moved domain functions.
- [x] 3.8 Run the targeted frontend tests before starting Phase 3.

## 4. Phase 3 - Extract Components

- [x] 4.1 Extract filter controls into `public/components/filter-bar.mjs`.
- [x] 4.2 Extract dashboard drill modal behavior into `public/components/drill-modal.mjs`.
- [x] 4.3 Extract project workbench table, tabs, row rendering, and sorting helpers into `public/components/project-workbench.mjs`.
- [x] 4.4 Extract project detail modal rendering and interactions into `public/components/project-detail-modal.mjs`.
- [x] 4.5 Extract sync controls and agent action controls into `public/components/sync-controls.mjs`.
- [x] 4.6 Update `public/app.js` to compose extracted components without changing business behavior.
- [x] 4.7 Update `public/test-harness.mjs` exports for moved component functions.
- [x] 4.8 Run targeted frontend tests for filters, drill modal, project detail modal, and sync controls. Browser manual verification is tracked in 7.3.

## 5. Phase 4 - Extract Pages

- [x] 5.1 Extract the rules page into `public/pages/rules.mjs`.
- [x] 5.2 Extract the developer documentation page into `public/pages/developer-docs.mjs`.
- [x] 5.3 Extract the project details workbench page into `public/pages/details.mjs`.
- [x] 5.4 Extract the franchise profile dashboard into `public/pages/franchise.mjs`.
- [x] 5.5 Extract the direct profile dashboard into `public/pages/direct.mjs`.
- [x] 5.6 Extract owner review into `public/pages/owner-review.mjs`.
- [x] 5.7 Extract the teams dashboard into `public/pages/teams.mjs`.
- [x] 5.8 Extract the overview dashboard into `public/pages/overview.mjs`.
- [x] 5.9 Ensure extracted pages expose the lifecycle/export hooks needed by `public/app.js`; static route helpers may stay minimal.
- [x] 5.10 Confirm extracted page modules avoid page-to-page coupling except deliberate shared helpers such as `profile-shared.mjs`.
- [x] 5.11 Update `public/app.js` to route and compose pages through lifecycle functions.
- [x] 5.12 Run targeted tests for extracted pages. Desktop browser checklist remains tracked in 7.3.

## 6. Phase 5 - Split Styles And Clean Up

- [x] 6.1 Create `public/styles/app.css` as the stylesheet entrypoint.
- [x] 6.2 Move shared design tokens into `public/styles/tokens.css`.
- [x] 6.3 Move reset, shell, sidebar, and shared typography styles into `public/styles/base.css`.
- [x] 6.4 Move shared filter, modal, tooltip, empty-state, and insight-card styles into `public/styles/components.css`.
- [x] 6.5 Move page-specific styles into `public/styles/pages/*.css` files aligned with extracted pages.
- [x] 6.6 Update `public/index.html` to load the split stylesheet entrypoint.
- [x] 6.7 Remove dead code from `public/app.js` and keep root `public/styles.css` as a compatibility redirect only.
- [x] 6.8 Confirm `public/app.js` is no more than 800 lines.
- [x] 6.9 Update `docs/handbook/development.md` and `docs/STATUS.md` with the completed frontend structure.

## 7. Verification And Completion

- [x] 7.1 Run full `node --test`.
- [x] 7.2 Confirm the targeted frontend test command passes after the final split.
- [ ] 7.3 Manually verify the 2K desktop flows listed in `docs/handbook/frontend-split-plan.md`.
- [x] 7.4 Run `openspec validate split-frontend-monolith` and `openspec validate --all`.
- [ ] 7.5 Archive the change only after implementation is complete and verified.

Note: 7.3 remains open in this cleanup pass because no persistent dev server/browser session was kept running under the service anti-hang rules.
