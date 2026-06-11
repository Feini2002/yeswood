## Why

As the system moves toward local final project data, operators need to see and resolve differences between DingTalk source values and local final values. The contract must ensure review decisions are explicit and do not mutate raw imports.

## What Changes

- Add a proposed `source-diff-review` capability.
- Define source/final comparison, explicit conflict state, raw import immutability, and durable accepted local decisions.
- Keep the change active until diff storage and UI are implemented.

## Capabilities

### New Capabilities
- `source-diff-review`: Comparison of DingTalk source values and local final values, conflict review state, accepted decision durability, and raw import immutability.

### Modified Capabilities
- None.

## Impact

- Future SQLite diff/review tables or fields.
- Future backend APIs for diff listing and decision recording.
- Future frontend diff confirmation view.
- Future tests for preserving raw imports and local override durability.
