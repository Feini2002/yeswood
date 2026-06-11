## Why

The project already has mature human-readable contracts for security, data authority, and field mapping, but only `frontend-architecture` is currently represented as a baseline OpenSpec spec. These three domains are high-risk because future P1/P2 work will add local edits, diff review, and field configuration on top of them.

## What Changes

- Add baseline OpenSpec specs for `security-boundary`, `data-authority`, and `field-mapping`.
- Keep the existing Markdown contracts as the human-readable authority for background and operational nuance.
- Capture only behavior-affecting boundaries as SHALL/MUST requirements and scenarios.
- Do not change application behavior or tests in this change.

## Capabilities

### New Capabilities
- `security-boundary`: Runtime and API boundaries that prevent secrets, upstream identifiers, and DingTalk write operations from reaching the frontend or public routes.
- `data-authority`: Data-source priority, local SQLite final project authority, DingTalk read-only import, pagination, and local override preservation.
- `field-mapping`: Raw DingTalk field preservation, display-label separation, standard field resolution, ambiguity reporting, and field catalog expectations.

### Modified Capabilities
- None.

## Impact

- Adds OpenSpec baseline specs under `openspec/specs/` after archive.
- References existing behavior covered by `docs/contracts/security-boundary.md`, `docs/contracts/data-authority.md`, and `docs/contracts/field-mapping.md`.
- No frontend runtime dependency, backend API behavior, database schema, or production configuration changes.
