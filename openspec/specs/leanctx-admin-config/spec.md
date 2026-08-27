## Purpose

Provide one reliable configuration contract for LeanCTX in which the Docker image defines the ai-engkit baseline, the Admin UI manages user overrides, and container lifecycle events preserve the user's effective configuration.

## Requirements

### Requirement: Dockerfile baseline is the canonical default

The system SHALL expose the LeanCTX configuration baseline packaged with the Docker image as the canonical default for the running ai-engkit release. The baseline SHALL include every configured key and value, including the complete `shell_allowlist_extra` command list.

#### Scenario: Admin displays the packaged baseline

- **WHEN** the Admin LeanCTX configuration page is opened for a configuration with no user override
- **THEN** each displayed Default value matches the configuration baseline packaged in the Docker image

#### Scenario: Reset restores the packaged baseline

- **WHEN** an administrator selects Reset to Defaults and confirms
- **THEN** the persisted runtime configuration is replaced with the current image baseline
- **AND** `shell_allowlist_extra` contains the commands declared by the Dockerfile baseline

### Requirement: Runtime configuration is seeded only when absent

The system SHALL initialize the persisted runtime configuration from the canonical baseline only when no runtime configuration exists. Startup SHALL NOT overwrite an existing runtime configuration with image defaults.

#### Scenario: First container startup

- **WHEN** the runtime configuration file does not exist
- **THEN** startup creates it from the canonical image baseline before LeanCTX services run

#### Scenario: Existing user configuration on restart

- **WHEN** the runtime configuration file exists with user values
- **THEN** container startup preserves those values and starts LeanCTX using them

#### Scenario: New image adds a configuration key

- **WHEN** an existing runtime configuration lacks a key present in the new image baseline
- **THEN** startup may add the missing key with the new baseline value
- **AND** startup SHALL NOT replace any existing user value

### Requirement: Admin edits persist as the effective configuration

The Admin UI SHALL allow an administrator to view and modify the persisted runtime configuration. A successful save SHALL be used by LeanCTX after restart without requiring the administrator to edit files manually.

#### Scenario: Save a configuration value

- **WHEN** an administrator changes a valid value and saves it
- **THEN** the runtime configuration stores the new value
- **AND** reloading the Admin page shows the new value

#### Scenario: Restart preserves a saved value

- **WHEN** an administrator saves a valid value and the container is restarted or recreated
- **THEN** LeanCTX starts with the saved value rather than the image baseline

#### Scenario: Invalid value is rejected

- **WHEN** an administrator submits a value that violates the configuration schema or type
- **THEN** the save is rejected with an actionable error
- **AND** the previous persisted configuration remains unchanged

### Requirement: Configuration sources are explicit

The system SHALL distinguish the immutable image baseline from the persisted runtime configuration. The baseline SHALL be stored outside the named volume used for user configuration, and the runtime file SHALL remain the only writable user state.

#### Scenario: Image rebuild with existing volume

- **WHEN** a new image is built while the runtime configuration volume already exists
- **THEN** the existing runtime configuration remains intact
- **AND** the new image baseline is available for Reset and missing-key migration

#### Scenario: Reset after image update

- **WHEN** Reset to Defaults is performed after the image baseline changes
- **THEN** the reset uses the new image baseline rather than stale values from the named volume

### Requirement: Malformed configuration is reported safely

The system SHALL detect malformed runtime configuration content and SHALL NOT silently treat it as an empty configuration.

#### Scenario: Malformed TOML at startup

- **WHEN** the runtime configuration cannot be parsed as valid TOML
- **THEN** startup reports the configuration error clearly
- **AND** LeanCTX SHALL NOT silently run with an empty replacement configuration

#### Scenario: Malformed TOML in Admin view

### Requirement: Admin applies saved configuration with an explicit daemon restart
The Admin editor MUST keep field edits pending until `Save Changes` is selected,
and MUST describe Apply as restarting the LeanCTX daemon in `ai-dev`.

#### Scenario: Unsaved edits cannot be applied
- **WHEN** the operator changes a field without saving
- **THEN** Apply remains unavailable and the UI instructs the operator to save first

#### Scenario: Saved configuration is applied
- **WHEN** the operator selects Save Changes and then Apply Saved Config
- **THEN** the saved `config.toml` is applied in `ai-dev` and the UI states that the LeanCTX daemon was restarted

### Requirement: Configuration is edited through structured fields
The Admin editor MUST NOT expose a Raw TOML editor or a second per-field
immediate-save workflow.

#### Scenario: Structured editor is displayed
- **WHEN** the operator opens the LeanCTX configuration page
- **THEN** the page displays structured fields, Save Changes, Validate Config, and Apply Saved Config controls without Raw TOML controls

- **WHEN** the Admin reads a malformed runtime configuration
- **THEN** the UI reports that the configuration requires repair
- **AND** the administrator can restore the canonical baseline without manually editing the volume

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
