## Why

P2 will turn the dashboard into a local project operations workbench. Before adding edit APIs or UI controls, the system needs a contract that local edits stay local, preserve audit history, and never write back to DingTalk.

## What Changes

- Add a proposed `local-editing-audit` capability.
- Define requirements for SQLite-only edits, audit records, DingTalk write prohibition, source difference visibility, and safe request handling.
- Leave implementation tasks open until local edit APIs and UI are intentionally built.

## Capabilities

### New Capabilities
- `local-editing-audit`: Local project edit safety, persistence, audit trail, source difference visibility, and malformed/unauthorized payload handling.

### Modified Capabilities
- None.

## Impact

- Future backend edit endpoints under `src/backend/server.mjs` and `src/backend/projectRepository.mjs`.
- Future frontend local edit UI in project details or operations workbench.
- Future tests for local edit persistence, audit append, security rejection, and no DingTalk write behavior.
