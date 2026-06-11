# field-mapping Specification

## Purpose
TBD - created by archiving change seed-core-contract-specs. Update Purpose after archive.
## Requirements
### Requirement: Raw field keys remain source keys
The system SHALL preserve DingTalk raw field keys for import, raw record storage, field catalogs, and `rawFields` lookup.

#### Scenario: Display label does not change source mapping
- **WHEN** a frontend display label is shortened or professionalized
- **THEN** backend import and raw field lookup MUST continue to use the original DingTalk field key

#### Scenario: Raw fields are shown through formatted display values
- **WHEN** project details render DingTalk-origin fields
- **THEN** the frontend SHOULD use backend-provided raw field keys and display values rather than inventing source field names

### Requirement: Standard field mapping is explicit and diagnosable
The system SHALL resolve standard fields through environment overrides, cached bindings, or automatic field rules with ambiguity warnings instead of silent guessing.

#### Scenario: Ambiguous field mapping is reported
- **WHEN** multiple source fields match the same standard semantic field
- **THEN** the resolver MUST report ambiguity and avoid silently choosing an unsafe field

#### Scenario: Stale environment mapping falls back safely
- **WHEN** an environment override points to a source column that no longer exists
- **THEN** the resolver MAY use cached or automatic mapping only if it can still identify a valid source field

### Requirement: Field display aliases are one-way
The system SHALL keep frontend display aliases separate from backend source keys and metric semantics.

#### Scenario: Alias improves display wording
- **WHEN** a field label such as an internal reminder is shortened for frontend display
- **THEN** that alias MUST NOT change source import, raw record storage, or KPI predicates

### Requirement: Field cleaning preserves auditability
The system SHALL normalize field values for display and metrics while preserving raw source values for audit and troubleshooting.

#### Scenario: Complex source value is formatted
- **WHEN** a source field contains an object, array, timestamp, or empty value
- **THEN** the system MAY expose a readable display value
- **AND** the original source field key and raw import record MUST remain traceable

### Requirement: Standard field semantics remain distinct
The system SHALL keep standard fields with different business meanings separate even if DingTalk field names sound similar.

#### Scenario: Priority status is not workflow stage
- **WHEN** a field maps to project priority/status semantics
- **THEN** it MUST NOT be used as the hard or soft workflow stage field unless a separate workflow mapping explicitly identifies it

