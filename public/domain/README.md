# domain/

Pure presentation-side business logic (no `document`, no direct DOM).

- `project-display.mjs` - owner/team display, assignment gaps, sleep-store detection
- `project-workflow.mjs` - stage/node/progress/pause/closure
- `project-reminders.mjs` - key dates, reminder stack, field gaps
- `personnel.mjs` - personnelArchitecture resolution
- `metrics-display.mjs` - KPI/tier formatting, drill filters, risk queue helpers

Dependency rule: `domain/` SHOULD import `lib/` and `dashboard/` presentation primitives only.

**Accepted split-phase exceptions** (see OpenSpec `frontend-architecture`):

- `personnel.mjs` imports `lib/dom.mjs` and `components/filter-bar.mjs` for team-owner select enhancement.
- `metrics-display.mjs` imports `components/filter-bar.mjs` (`readActiveProjectFilters`) and `dashboard/project-lifecycle.mjs` for lifecycle labels.

These modules MUST NOT import `pages/`. Lifting filter reads to callers is tracked as optional follow-up, not an archive blocker.
