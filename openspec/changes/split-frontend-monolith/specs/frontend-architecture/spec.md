## ADDED Requirements

### Requirement: Entrypoint orchestration boundary
The frontend SHALL keep `public/app.js` as the static application entrypoint responsible for initialization, route orchestration, shared event wiring, and page/module composition after the split is complete.

#### Scenario: App entrypoint remains thin
- **WHEN** the frontend split reaches its completion criteria
- **THEN** `public/app.js` SHALL be no more than 800 lines and SHALL delegate page rendering and domain logic to imported modules

#### Scenario: Entrypoint preserves runtime model
- **WHEN** the split introduces new frontend modules
- **THEN** the frontend SHALL continue to run as static browser assets using native ES modules without requiring a production bundler

### Requirement: Layered module dependency direction
The frontend SHALL organize extracted code into layered modules with documented one-way dependencies. The target direction is: `pages` may depend on `components`, `domain`, `dashboard`, and `lib`; `components` may depend on `domain`, `dashboard`, and `lib`; `domain` may depend on `lib` and `dashboard` presentation primitives; `lib` SHOULD NOT depend on `pages/` or `components/`.

The following **accepted exceptions** are intentional for this change and MUST be documented in directory README files:

| Exception | Rationale |
| --- | --- |
| `public/lib/dashboard-loader.mjs` imports `domain/`, `components/`, and `pages/` | App-shell orchestration module colocated in `lib/` during split; coordinates sync, filters, and page render after data load. Future refactor may move it to a dedicated coordinator module. |
| `public/domain/personnel.mjs` and `public/domain/metrics-display.mjs` import `components/filter-bar.mjs` and/or `lib/dom.mjs` | Personnel select enhancement and active-filter merge require UI context that was not fully lifted in this change. |
| `public/components/drill-modal.mjs` imports `pages/owner-review.mjs` (`closeOwnerReviewMemberModal`) | Teams-embedded owner-review modal close is wired through the teams submodule; callback injection deferred to a follow-up. |
| `public/pages/*.mjs` may import `profile-shared.mjs` | Non-route shared helper for franchise/direct profile dashboards. |
| `public/pages/teams.mjs` imports `owner-review.mjs` | Owner-review is a teams submodule, not a separate navigation page. |
| `public/dashboard/` imported from `lib/`, `domain/`, `components/`, and `pages/` | Pre-split presentation primitive layer; see `public/dashboard/README.md`. |

#### Scenario: Page modules do not import each other except documented helpers
- **WHEN** a page is extracted into `public/pages/*.mjs`
- **THEN** that page module MUST NOT import another routable page module directly
- **AND** it MAY import `profile-shared.mjs` or, for teams only, `owner-review.mjs` as documented submodule helpers

#### Scenario: Domain modules avoid page imports
- **WHEN** project workflow, reminder, personnel, or metrics-display logic is moved into `public/domain/*.mjs`
- **THEN** those modules MUST NOT import from `public/pages/`
- **AND** documented filter-bar or dashboard primitive imports are permitted per the exception table above

### Requirement: Domain logic minimizes DOM dependency
Extracted domain modules SHALL expose functions for workflow, reminder, personnel, assignment, and metrics-display decisions with minimal browser coupling.

#### Scenario: Core domain exports are testable in Node
- **WHEN** tests import workflow, reminder, or project-display helpers from `public/domain/*.mjs` in a Node test context
- **THEN** those exports MUST NOT require `document`, `window`, live DOM nodes, or browser event listeners

#### Scenario: Documented UI-coupled domain helpers
- **WHEN** `personnel.mjs` or `metrics-display.mjs` imports filter-bar or DOM registry helpers
- **THEN** that coupling is an accepted split-phase exception documented in `public/domain/README.md`
- **AND** a follow-up change MAY lift filter reads to page or component callers without changing business behavior

### Requirement: Page modules expose stable lifecycle functions
Extracted page modules SHALL expose stable lifecycle functions so `public/app.js` can orchestrate routing and rendering without owning page internals.

#### Scenario: Page module is mounted by app context
- **WHEN** a main page is extracted to `public/pages/*.mjs`
- **THEN** it SHALL expose `render(ctx)` and MAY expose `load(ctx)`, `mount(ctx)`, or `bindEvents(ctx)` when the page needs those lifecycle hooks

#### Scenario: Shared context carries app dependencies
- **WHEN** `public/app.js` invokes a page lifecycle function
- **THEN** shared dependencies such as state, DOM references, API helpers, navigation helpers, and global render callbacks SHALL be passed through a context object rather than re-created in the page

### Requirement: Frontend behavior tests use an explicit harness
Frontend behavior tests SHALL load extracted browser code through an explicit test harness instead of depending on ad hoc concatenation of `public/app.js`.

#### Scenario: Harness re-exports tested functions
- **WHEN** a behavior-tested function moves out of `public/app.js`
- **THEN** `public/test-harness.mjs` SHALL re-export the function or its new module-level entry so existing tests can target the new boundary

#### Scenario: Phase migrations keep tests green
- **WHEN** each split phase completes
- **THEN** `node --test tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs tests/homeDirectorMetrics.test.mjs` SHALL pass before the next phase starts

### Requirement: CSS split follows page and component boundaries
The frontend SHALL split the large stylesheet into a styles directory whose files align with shared tokens, base layout, components, and page-specific surfaces.

#### Scenario: Stylesheet entrypoint aggregates split CSS
- **WHEN** CSS is split during the frontend migration
- **THEN** `public/styles/app.css` SHALL act as the stylesheet entrypoint and aggregate the split CSS files

#### Scenario: Page styles stay near page ownership
- **WHEN** a main page is extracted into `public/pages/*.mjs`
- **THEN** page-specific styling SHALL be moved toward a matching `public/styles/pages/*.css` file unless the rule is a shared token, base, or component style

### Requirement: Split work preserves current behavior
The frontend monolith split SHALL be treated as structural migration and MUST NOT intentionally change business behavior, visual design, backend API contracts, or DingTalk data boundaries.

#### Scenario: No runtime dependency is added
- **WHEN** split work is implemented
- **THEN** it MUST NOT add React, Vue, Svelte, Vite, Webpack, or another runtime framework/build requirement to production operation

#### Scenario: Existing verification remains authoritative
- **WHEN** a split phase changes frontend module ownership
- **THEN** the existing frontend and relevant backend tests SHALL remain passing, and any intentional behavior change MUST be captured in a separate OpenSpec change
