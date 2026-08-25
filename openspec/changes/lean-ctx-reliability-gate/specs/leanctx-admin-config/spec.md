## ADDED Requirements

### Requirement: Explicit compression-off migration
The system MUST support a one-time, versioned migration that creates a backup before changing compression. The migration MUST run only when the current value is `lite`, `standard`, or `max`, MUST set compression explicitly to `off`, and MUST preserve unrelated configuration values. It MUST NOT auto-apply or restart services.

#### Scenario: Eligible migration
- **WHEN** the versioned migration marker is absent and compression is `lite`, `standard`, or `max`
- **THEN** a versioned backup is created, compression becomes `off`, unrelated values remain unchanged, and apply or restart remains administrator initiated

#### Scenario: Migration is already complete or ineligible
- **WHEN** the marker exists or compression is already `off` or another value
- **THEN** no migration or backup is performed

### Requirement: Report-only behavioral drift
The system MUST report baseline, global, project, daemon, and all long-lived container behavioral drift without mutating configuration or lifecycle state. CodeGraph and native behavior MUST be authoritative. Memory and knowledge behavior MUST be exempt from drift and benefit evaluation.

#### Scenario: Project override and daemon comparison
- **WHEN** a project override exists or the daemon is available
- **THEN** the report identifies the project and daemon comparisons separately from baseline and global state, without applying changes

#### Scenario: Malformed config or unavailable daemon
- **WHEN** configuration is malformed or the daemon is unavailable
- **THEN** the report identifies the condition and does not mutate state

### Requirement: Fixed external reliability gate
The system MUST evaluate exactly 20 fixed scenarios under two fixed profiles. It MUST retain automatic routing only when there are zero incidents and independently measured net benefit is at least 20 percent. Integration depth MUST NOT count as a benefit.

#### Scenario: Passing gate
- **WHEN** both profiles complete all 20 scenarios with zero incidents and at least 20 percent independent net benefit
- **THEN** automatic Read, Search, and Shell routing remains enabled

#### Scenario: Missing metrics or failed gate
- **WHEN** any scenario is incomplete, required metrics are missing, an incident occurs, or net benefit is below 20 percent
- **THEN** automatic Read, Search, and Shell routing is disabled while MCP, Admin, and persistence remain available

### Requirement: Safe administrative boundaries
The system MUST keep shell writes disabled and the path jail enabled. Apply and restart MUST be explicit administrator actions, including after migration or evaluation.

#### Scenario: Non-automated lifecycle action
- **WHEN** migration or evaluation completes
- **THEN** no apply or restart occurs automatically
