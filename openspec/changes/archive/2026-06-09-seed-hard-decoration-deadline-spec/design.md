## Context

The hard decoration deadline system is already implemented as layered rule governance: executable matrix and workday calendars in code/data, human-readable policy in the operational rulebook, and summary display in the frontend rules page.

This OpenSpec change creates the baseline contract for the already-effective hard decoration rules. It intentionally avoids specifying soft decoration and staging deadlines because those sections remain pending.

## Goals / Non-Goals

**Goals:**
- Make China-workday deadline semantics explicit.
- Preserve DingTalk form priority for final delay status.
- Preserve system deadline fallback when form data is missing.
- Keep delay facts separate from efficiency analysis and process timeout records.

**Non-Goals:**
- Do not change matrix offsets or calendar data.
- Do not add soft decoration or staging deadlines.
- Do not change frontend rule-page design.

## Decisions

### Decision 1: Baseline only effective rules

Only the hard decoration rules that are already executable and tested become SHALL/MUST requirements. Pending soft decoration and staging sections stay out of the spec until confirmed.

### Decision 2: Explicitly separate final status, reminders, and efficiency

The rulebook distinguishes final delay status, system reminders, and efficiency KPIs. The spec keeps those concepts separate to prevent future simplification from erasing useful operational facts.

## Risks / Trade-offs

- Rulebook and spec can drift -> Mitigation: keep `tests/rulesDocs.test.mjs` and add future drift checks for required specs.
- Future rule changes may update code but not OpenSpec -> Mitigation: development handbook now requires an OpenSpec change for deadline, reminder, delay, or workday-calendar changes.
