## Context

The data authority contract says local SQLite final data outranks imported DingTalk values, while raw DingTalk records remain source evidence. P2 diff review will make that relationship visible and actionable.

## Goals / Non-Goals

**Goals:**
- Require source and final values to be comparable.
- Require conflicts to enter explicit review state.
- Preserve raw imported records unchanged.
- Preserve accepted local decisions across future syncs.

**Non-Goals:**
- Do not implement the diff review UI in this change.
- Do not define every diff category before implementation.
- Do not write review decisions back to DingTalk.

## Decisions

### Decision 1: Review decisions are local facts

Accepting a local value, marking a source value stale, or choosing a new final value must be recorded locally and must not mutate the raw import record.

### Decision 2: Conflicts are explicit states

Silent replacement creates audit risk. Differences that matter to final data should become reviewable states or accepted decisions.

## Risks / Trade-offs

- Not every field needs manual diff review -> Mitigation: implementation can define field scope, but reviewed fields must follow this contract.
- Sync cadence may be manual -> Mitigation: decisions must survive later sync regardless of schedule.
