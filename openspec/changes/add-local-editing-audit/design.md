## Context

The current system reads DingTalk data into local SQLite and presents final project data through local APIs. P2 will add local operations workbench behavior. That work must not blur the line between local final data and DingTalk source records.

## Goals / Non-Goals

**Goals:**
- Define the safety contract before edit endpoints exist.
- Ensure every local edit is auditable.
- Keep source values and source differences visible.

**Non-Goals:**
- Do not implement local edit APIs in this change.
- Do not define authentication or role permissions beyond safe rejection requirements.
- Do not change current read-only frontend behavior yet.

## Decisions

### Decision 1: Local edits write only SQLite

All edit behavior targets local SQLite project data and audit tables. DingTalk remains read-only import.

### Decision 2: Audit append is part of the edit contract

Editing a final value without an audit trail would break later review and rollback. The audit requirement is baseline, not optional polish.

## Risks / Trade-offs

- Exact edit schema is not finalized -> Mitigation: keep this change active until implementation decides fields and audit payloads.
- Permission model may expand later -> Mitigation: add a separate security or permission delta if deployment scope changes.
