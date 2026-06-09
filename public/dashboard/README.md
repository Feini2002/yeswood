# dashboard/

Pre-split dashboard UI primitives and chart helpers. These modules predate the `lib/` / `domain/` / `components/` / `pages/` layering and remain the shared presentation toolkit for charts, tooltips, empty states, insight cards, and lifecycle labels.

## Ownership

| Module | Role |
| --- | --- |
| `tooltip.mjs` | Tooltip bind/hide helpers used by shell DOM and pages |
| `empty-state.mjs` | Shared empty-state markup |
| `insight-card.mjs` | KPI / insight card rendering |
| `chart-bar.mjs`, `chart-column.mjs` | Bar and column chart renderers |
| `annual-entry-structure.mjs` | Overview annual entry structure widget |
| `home-director-metrics.mjs` | Director overview model builder |
| `project-lifecycle.mjs` | Lifecycle stage labels |
| `province-display.mjs` | Province display helper |

## Dependency rule (accepted exception)

`dashboard/` is a **presentation primitive layer**, not a pure domain layer. It may be imported by `lib/` (e.g. `dom.mjs`, `router.mjs` for tooltip wiring), `domain/` (e.g. lifecycle labels), `components/`, and `pages/`.

`dashboard/` modules MUST NOT import from `pages/` or `components/`. They may import from `lib/` when needed for formatting or constants.

Physical migration of these files into `components/` or `lib/` is out of scope for `split-frontend-monolith`; future refactors should preserve import stability via this README and OpenSpec exceptions.
