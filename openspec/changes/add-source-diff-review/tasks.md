## 1. Diff Data Model

- [ ] 1.1 Define which fields enter diff review.
- [ ] 1.2 Add local storage for source/final differences and review decisions.
- [ ] 1.3 Add tests for raw import immutability and accepted decision durability.

## 2. Backend Review API

- [ ] 2.1 Add API to list source/final differences.
- [ ] 2.2 Add API to record review decisions locally.
- [ ] 2.3 Reject malformed or unsafe review payloads.

## 3. Frontend Review Flow

- [ ] 3.1 Add diff review workbench or panel.
- [ ] 3.2 Show source value, local final value, review state, and decision metadata.
- [ ] 3.3 Keep review interactions separate from DingTalk raw records.

## 4. Verification

- [ ] 4.1 Run source diff review tests.
- [ ] 4.2 Run data authority and field mapping tests.
- [ ] 4.3 Run `openspec.cmd validate add-source-diff-review`.
- [ ] 4.4 Archive only after implementation and verification are complete.
