## ADDED Requirements

### Requirement: Local SQLite is final project data authority
The system SHALL treat local SQLite project data as the final project data source after DingTalk records are imported.

#### Scenario: Local final data is read before compatibility cache
- **WHEN** SQLite final project data is available
- **THEN** project APIs and metrics SHOULD read from SQLite final project views rather than JSON compatibility snapshots

#### Scenario: Local override survives later sync
- **WHEN** a local final project field has been explicitly overridden
- **THEN** a later DingTalk sync MUST NOT silently overwrite that local value

### Requirement: DingTalk remains an import source
The system SHALL treat DingTalk AI Table records as external source facts for initialization, refresh, and audit comparison, not as the browser-facing data authority.

#### Scenario: DingTalk source value differs from local final value
- **WHEN** a DingTalk import value conflicts with an existing local final value
- **THEN** the system MUST preserve enough source difference information for review instead of silently treating the DingTalk value as final

### Requirement: DingTalk import handles pagination completely
The sync service SHALL read DingTalk records until `hasMore=false`.

#### Scenario: Missing next token fails sync
- **WHEN** DingTalk returns `hasMore=true` without `nextToken`
- **THEN** sync MUST fail visibly instead of silently dropping remaining records

#### Scenario: Multiple pages are imported
- **WHEN** DingTalk returns `hasMore=true` with a valid `nextToken`
- **THEN** the sync service MUST request subsequent pages until `hasMore=false`

### Requirement: Local edits do not mutate raw imports
The system SHALL keep raw imported records separate from final local project data and future local edits.

#### Scenario: Local final field is edited
- **WHEN** a user or backend process changes a final project field locally
- **THEN** the raw DingTalk import record MUST remain available as source evidence

### Requirement: Data defaults are explicit
The system SHALL distinguish missing source data from safe or complete business states.

#### Scenario: Required source field is missing
- **WHEN** a source field needed for risk, schedule, owner, or lifecycle interpretation is absent
- **THEN** the system MUST expose an unknown, missing, warning, or review state rather than silently converting it into a safe business result
