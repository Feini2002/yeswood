## ADDED Requirements

### Requirement: DingTalk and local final values can be compared
The system SHALL provide a local representation that can compare selected DingTalk source values with local final project values.

#### Scenario: Source and final values differ
- **WHEN** an imported DingTalk source value differs from the local final value for a reviewed field
- **THEN** the system MUST be able to expose both values and the field identity to a review workflow

### Requirement: Conflicts enter an explicit review state
The system SHALL represent meaningful source/final conflicts as explicit review states instead of silently replacing either value.

#### Scenario: Sync detects changed source value for locally managed field
- **WHEN** a later sync imports a source value that conflicts with a locally managed final value
- **THEN** the system MUST preserve the local final value
- **AND** it MUST make the conflict reviewable or record why it is ignored

### Requirement: Review decisions do not mutate raw imported records
The system SHALL store review decisions as local facts without changing raw DingTalk import records.

#### Scenario: Operator accepts a local final value
- **WHEN** an operator records a review decision to keep a local final value
- **THEN** the raw DingTalk import record MUST remain unchanged

### Requirement: Accepted local decisions survive later sync
The system SHALL preserve accepted local review decisions across later DingTalk imports.

#### Scenario: Later sync repeats old source value
- **WHEN** a later sync imports the same source value that was previously reviewed and rejected for final use
- **THEN** the accepted local decision MUST remain effective unless a new explicit review decision changes it

### Requirement: Review workflow never writes DingTalk
The system SHALL NOT write review decisions, accepted values, rejected values, or notes back to DingTalk.

#### Scenario: Operator records review decision
- **WHEN** the backend saves a source diff review decision
- **THEN** it MUST persist the decision locally and MUST NOT call DingTalk write APIs
