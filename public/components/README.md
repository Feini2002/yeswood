# components/

Reusable UI modules shared by pages.

- `filter-bar.mjs` - project filter controls and active-filter reads
- `drill-modal.mjs` - dashboard drill modal interactions
- `project-workbench.mjs` / `project-cell-render.mjs` - project list/workbench rendering
- `project-detail-modal.mjs` - project detail modal rendering and interaction
- `sync-controls.mjs` - sync and analysis-agent controls
- `team-hero-stat.mjs` - team hero stat card helper

Dependency rule: `components/` may import `domain/`, `dashboard/`, and `lib/`.

**Accepted exception:** `drill-modal.mjs` imports `closeOwnerReviewMemberModal` from `pages/owner-review.mjs` because owner-review is embedded in teams. Prefer callback injection in a follow-up; do not add further `components → pages` imports.
