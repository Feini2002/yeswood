# personnel-responsibility-routing Specification

## Purpose
TBD - created by archiving change seed-metrics-responsibility-specs. Update Purpose after archive.
## Requirements
### Requirement: Local personnel architecture is organization authority
The system SHALL treat local personnel architecture as the authority for organization relationships, roles, teams, aliases, hidden status, and responsibility identities.

#### Scenario: Project collaboration does not define team membership
- **WHEN** a person appears with another person on the same DingTalk project row
- **THEN** the system MUST NOT infer that the person belongs to that owner's team

#### Scenario: Local role assignment overrides project-derived guesses
- **WHEN** local personnel master data identifies a person's role, discipline, or team
- **THEN** that local personnel record MUST take precedence over project-row inference

### Requirement: Responsibility identities use stable ids
The system SHALL use stable responsibility identity ids for split or derived responsibility channels instead of using display names as statistical keys.

#### Scenario: Split owner keeps stable identity id
- **WHEN** a natural person has separate hard and soft responsibility identities
- **THEN** metrics and frontend selection MUST use the identity id to distinguish those channels

#### Scenario: Display name can change without changing identity
- **WHEN** a responsibility identity display name is adjusted
- **THEN** historical metric routing MUST remain attached to the same stable identity id

### Requirement: Dual-discipline owners route by explicit slot
The system SHALL route dual-discipline owners and creative cross-discipline personnel through explicit hard, soft, or neutral responsibility slots.

#### Scenario: Dual owner hard identity matches hard owner slot
- **WHEN** a dual-discipline natural person appears in a hard owner slot
- **THEN** the hard responsibility identity MAY receive the responsibility item

#### Scenario: Total owner column alone is not enough for multi-identity owner
- **WHEN** a multi-identity person appears only in the total `负责人` column and explicit hard/soft owner slots are absent
- **THEN** the system MUST route the match to a review channel rather than silently choosing a responsibility identity

### Requirement: Responsibility discipline is not inferred from workflow or tier
The system SHALL determine hard or soft responsibility discipline from explicit responsibility slots and local personnel configuration, not from workflow progress fields or store tier.

#### Scenario: Hard workflow does not prove hard owner identity
- **WHEN** a project has hard workflow progress
- **THEN** the system MUST NOT infer a person's hard responsibility identity unless that person is present in a matching hard responsibility slot or local configuration supports that route

#### Scenario: Store tier does not prove discipline
- **WHEN** a project belongs to a regular or sinking tier
- **THEN** the system MUST NOT use that tier alone to infer the responsible person's hard or soft discipline

### Requirement: Unclear slot matches enter review channel
The system SHALL keep unclear, ambiguous, or insufficient responsibility matches out of explicit main metrics.

#### Scenario: Missing explicit slot creates review item
- **WHEN** a responsibility match lacks the explicit slot evidence required for a multi-identity person
- **THEN** the match MUST enter a pending review or data-quality channel

#### Scenario: Review channel does not write back to DingTalk
- **WHEN** a record enters the review channel
- **THEN** the system MUST NOT mutate DingTalk raw fields or write correction data back to DingTalk

### Requirement: Natural-person summaries deduplicate projects
The system SHALL distinguish responsibility-item counts from natural-person project summaries.

#### Scenario: One project matches two identities for same natural person
- **WHEN** a project legitimately matches both hard and soft responsibility identities for one natural person
- **THEN** identity-level counts MAY include both responsibility items
- **AND** natural-person project summaries MUST deduplicate by project id when reporting project counts

