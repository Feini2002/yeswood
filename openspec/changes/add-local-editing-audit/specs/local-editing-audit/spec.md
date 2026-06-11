## ADDED Requirements

### Requirement: Local edits write only SQLite
The system SHALL persist project edits only to local SQLite final project data and related local audit structures.

#### Scenario: User edits a final project field
- **WHEN** a user edits a local final project field
- **THEN** the backend MUST write the accepted value to local SQLite
- **AND** it MUST NOT write the value to DingTalk

### Requirement: Local edits append audit records
The system SHALL append an audit record for every accepted local edit.

#### Scenario: Accepted edit changes a value
- **WHEN** an edit changes a local final value
- **THEN** the system MUST record the edited field, old value, new value, timestamp, source of change, and project identifier in local audit storage

### Requirement: Local edits never write DingTalk
The system SHALL NOT call DingTalk create, update, delete, or batch-write APIs as part of local editing.

#### Scenario: Edit endpoint receives a valid local edit
- **WHEN** the backend processes a valid local edit request
- **THEN** it MUST complete without invoking any DingTalk write operation

### Requirement: Local edits preserve source difference visibility
The system SHALL keep DingTalk source values and local final values distinguishable after a local edit.

#### Scenario: Local value differs from latest source value
- **WHEN** a local edit makes the final value differ from the latest imported DingTalk source value
- **THEN** the system MUST preserve enough metadata for a future diff or review view to explain that difference

### Requirement: Malformed or unauthorized edit payloads fail safely
The system SHALL reject malformed, oversized, unauthorized, cross-site, or unsupported local edit payloads without mutating project data.

#### Scenario: Invalid edit request is submitted
- **WHEN** a local edit request lacks required intent, fails validation, or is malformed
- **THEN** the backend MUST reject the request
- **AND** local final project data and audit records MUST remain unchanged
