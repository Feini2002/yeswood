# Desktop Polish Hardening Design

## Goal

Do one desktop-only polish and hardening pass for the local operations dashboard. The pass improves the current front-end experience without mobile adaptation and without changing DingTalk/backend data semantics.

## Scope

- Keep all changes focused on the static front end under `public/` and behavior tests under `tests/`.
- Preserve the existing sidebar, dashboard pages, filters, project workbench, team dashboard, drill modal, and detail modal.
- Add resilient loading, empty, and error states so failed or incomplete API payloads do not leave blank panels or uncaught promise failures.
- Improve desktop scan quality for the project workbench and operational panels through spacing, stable dimensions, clearer empty states, and safer overflow handling.

## Non-Goals

- No mobile adaptation.
- No backend field meaning changes.
- No DingTalk form logic, validation, or source-data corrections.
- No broad redesign or routing restructure.

## Design

The implementation adds small front-end utilities for normalizing API payloads and rendering consistent dashboard status panels. `refresh()` becomes the single safe path for reloading the dashboard: it shows a lightweight loading state, catches failures, renders an actionable error state, and leaves topbar controls usable. The details workbench receives richer empty-state markup with page-specific copy and a stable full-width row.

The visual polish stays quiet and operational. It keeps the current Yeswood green and desktop dashboard density, but tightens text overflow, table row affordances, and status-panel layout so operators can scan repeated views without layout jumps.

## Verification

- Add behavior tests for payload normalization, refresh failure handling, and project workbench empty states.
- Run `node --test`.
- Verify the local dashboard in the browser on overview, teams, and details desktop views.
