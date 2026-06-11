## ADDED Requirements

### Requirement: Project status and workflow fields remain separate
The system SHALL keep management priority status, hard/soft workflow stage, scheme status, and management dates as separate metric inputs.

#### Scenario: Priority status is not workflow stage
- **WHEN** a project has a `项目状态` or standard `status` value
- **THEN** that value MUST NOT be used as the hard or soft workflow stage

#### Scenario: Scheme status does not fall back to generic delay alone
- **WHEN** calculating scheme completion or scheme delay KPIs
- **THEN** the metric MUST use the scheme field semantics and MUST NOT rely only on generic `isDelayed`

### Requirement: Store tier and responsibility discipline are orthogonal
The system SHALL treat store tier and responsibility discipline as independent dimensions.

#### Scenario: Tier does not choose a single workflow track
- **WHEN** a project is classified as regular, sinking, or another store tier
- **THEN** the metric MUST NOT infer that only hard or only soft workflow should be counted from the tier alone

#### Scenario: Dual-track progress can contribute inside one tier
- **WHEN** hard or soft workflow evidence exists for a project in a tier row
- **THEN** both tracks MAY contribute according to the metric predicate without changing the tier classification

### Requirement: OwnerMonthly scope uses responsibility slots and dashboard context
The system SHALL scope ownerMonthly and team dashboards by explicit owner responsibility slots, responsibility identities, and dashboard context.

#### Scenario: Responsibility identity routes by slot
- **WHEN** an ownerMonthly query uses a responsibility identity for a hard or soft owner
- **THEN** the metric MUST match the corresponding hard or soft owner slot instead of using only a natural-person display name

#### Scenario: Dashboard context filters by explicit project scope
- **WHEN** ownerMonthly metrics request direct, franchise, or all context
- **THEN** the metric MUST apply the corresponding explicit project scope field rather than inferring scope from owner identity

### Requirement: Open delayed excludes closed design responsibility
The open-delay KPI SHALL not blame active design responsibility for projects whose relevant design responsibility is already closed.

#### Scenario: Closed design responsibility is excluded from open delay blame
- **WHEN** a project is past the management due date but its design responsibility is closed
- **THEN** active design responsibility delay metrics MUST exclude it from designer open-delay responsibility

#### Scenario: Active unclosed project may be open delayed
- **WHEN** a project has an overdue management due date and relevant design responsibility remains open
- **THEN** open-delay metrics MAY count it according to the active profile scope

### Requirement: MonthlyOps uses explicit stage date fields
The monthly operations view SHALL count monthly volume from explicit stage dates and stage evidence rather than from unrelated update timestamps alone.

#### Scenario: Hard plan monthly volume uses hard plan dates
- **WHEN** calculating hard plan monthly volume
- **THEN** the metric MUST use hard plan start or hard plan finish evidence for the target month

#### Scenario: Site volume requires site-stage evidence
- **WHEN** calculating site monthly volume
- **THEN** the metric MUST require site, staging, or closure stage evidence rather than merely a project update in the month
