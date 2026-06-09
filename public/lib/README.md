# lib/

Shared frontend utilities with no business-page dependencies.

- `api.mjs` - fetchJson, API endpoint constants, dashboard payload normalization
- `constants.mjs` - dashboard context, development-only pages, filterable pages
- `dom.mjs` - shell-level `elements` registry, tooltip binding, panel insight helpers
- `format.mjs` - escapeHtml, formatDate*, displayOrDash
- `router.mjs` - hash routing, showPage, navigate* (uses `configureRouter` hooks from app.js)
- `state.mjs` - shared `state` object and reset helper
- `dashboard-loader.mjs` - **app-shell orchestration** (sync, filters, page render after load); accepted exception — imports `domain/`, `components/`, `pages/`
- `view-coordinator.mjs` - cross-component refresh hooks after modal actions
- `runtime-flags.mjs` - development / intranet runtime flags

Dependency rule: ordinary `lib/` utilities must not import from `domain/`, `components/`, or `pages/`. Only `dashboard-loader.mjs` is exempt as the post-split app-shell coordinator colocated here until a dedicated coordinator module exists.
