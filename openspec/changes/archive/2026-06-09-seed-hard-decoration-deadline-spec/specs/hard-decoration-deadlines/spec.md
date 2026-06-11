## ADDED Requirements

### Requirement: Y plus N uses China workdays
The system SHALL calculate hard decoration `Y + N` deadlines using China workdays, including statutory holidays and adjusted workdays from local calendar data.

#### Scenario: Workday offset skips non-workdays
- **WHEN** a hard decoration deadline is calculated from the measure date `Y`
- **THEN** each `Y + N` offset MUST count China workdays rather than natural calendar days

#### Scenario: Calendar coverage is required
- **WHEN** a hard decoration deadline would require dates outside the available local China workday calendar coverage
- **THEN** the calculation MUST fail visibly or require calendar data to be added rather than silently falling back to natural days

### Requirement: DingTalk form delay result has final-status priority
The system SHALL preserve DingTalk form delay result fields as the priority source for final hard decoration delay status when those fields are filled.

#### Scenario: Filled form delay result overrides fallback final status
- **WHEN** a hard decoration project has a filled delay result field such as hard scheme status
- **THEN** the final delay status MUST use that form result before using system deadline fallback

#### Scenario: Reminder generation remains rule-driven
- **WHEN** the final delay status comes from a filled form result
- **THEN** system reminders MAY still be generated from backend deadline rules without overwriting the final form result

### Requirement: System deadline fills missing form data
The system SHALL use backend hard decoration deadline rules as a fallback when form delay data is missing or not filled.

#### Scenario: Missing form result exposes fallback delay
- **WHEN** a hard decoration project has enough baseline data for deadline calculation but no filled final delay result
- **THEN** the system MUST expose rule-side delay or review status from the calculated deadline

#### Scenario: Missing baseline data enters review state
- **WHEN** the project lacks required baseline data such as measure date or area information needed for calculation
- **THEN** the system MUST expose missing-data or manual-review status instead of treating the project as safe

### Requirement: Floor plan deadline and efficiency are separate
The system SHALL record floor-plan deadline delay and shifted-start efficiency as separate facts.

#### Scenario: Late start can still be efficient after shift
- **WHEN** a project starts floor-plan work after the original start deadline but finishes within the shifted workday budget from actual start
- **THEN** the project MAY be marked deadline-delayed while also recording efficiency as OK

#### Scenario: Shifted budget can be exceeded
- **WHEN** a project exceeds both the original deadline and the shifted workday budget from actual start
- **THEN** the system MUST record deadline delay and efficiency timeout separately

### Requirement: Construction drawing process timeout and final delay remain separate
The system SHALL keep construction drawing startup timeout, draft return timeout, mall review risk, and final construction review delay as distinct records.

#### Scenario: Process timeout does not automatically mean final construction delay
- **WHEN** construction drawing startup or draft return is late but final review finishes inside the final deadline
- **THEN** the system MUST preserve the process timeout record without marking final construction review delayed solely for that reason

#### Scenario: Final review beyond deadline is final stage delay
- **WHEN** construction drawing final review finishes after the calculated final review deadline or remains unfinished past it
- **THEN** the system MUST expose final construction stage delay or review status

### Requirement: Rulebook and executable matrix stay synchronized
The system SHALL keep hard decoration rule changes synchronized across executable rules, calendar data, human-readable rulebook, frontend rule summary, and tests.

#### Scenario: Matrix value changes
- **WHEN** a hard decoration matrix offset, workday rule, reminder node, or delay predicate changes
- **THEN** the executable rule, relevant docs, frontend summary, and related tests MUST be reviewed together

#### Scenario: Pending rules are not effective requirements
- **WHEN** a soft decoration, staging, or unconfirmed hard decoration parameter remains marked pending
- **THEN** it MUST NOT be written as an effective hard decoration SHALL requirement until confirmed
