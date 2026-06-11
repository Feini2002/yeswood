## 1. Backend Editing Contract

- [ ] 1.1 Design SQLite tables or columns for local final edits and audit records.
- [ ] 1.2 Add tests proving local edits write only SQLite and append audit records.
- [ ] 1.3 Implement local edit repository functions.
- [ ] 1.4 Add protected backend edit endpoints.

## 2. Frontend Editing Flow

- [ ] 2.1 Add project workbench or detail UI for local edits.
- [ ] 2.2 Surface source value versus local final value where relevant.
- [ ] 2.3 Handle malformed, rejected, and failed edit responses without losing current page state.

## 3. Verification

- [ ] 3.1 Run local edit API tests.
- [ ] 3.2 Run security tests that prove DingTalk write APIs are not introduced.
- [ ] 3.3 Run `openspec.cmd validate add-local-editing-audit`.
- [ ] 3.4 Archive only after implementation and verification are complete.
