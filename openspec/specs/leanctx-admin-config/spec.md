## Purpose

Provide one reliable configuration contract for LeanCTX in which the Docker image defines the ai-engkit baseline, the Admin UI manages user overrides, and container lifecycle events preserve the user's effective configuration.

## Requirements

### Requirement: Docker image baseline is the canonical default

The system SHALL expose the LeanCTX configuration baseline packaged with the Docker image (`/etc/lean-ctx/config.default.toml`) as the canonical default. Reset SHALL restore exactly this baseline.

#### Scenario: Admin displays the packaged baseline

- **WHEN** the Admin LeanCTX configuration page is opened for a configuration with no user override
- **THEN** each displayed Default value matches the configuration baseline packaged in the Docker image

#### Scenario: Reset restores the packaged baseline

- **WHEN** an administrator selects Reset to Defaults and saves
- **THEN** the persisted global configuration is replaced with the current image baseline

### Requirement: Global persisted config is seeded only when absent

The system SHALL initialize the persisted global configuration (`/home/devuser/.config/lean-ctx/config.toml`) from the canonical baseline only when no global configuration exists. Startup SHALL NOT overwrite an existing global configuration with image defaults. The Admin UI SHALL treat this global file as the only user-writable configuration layer.

#### Scenario: First container startup

- **WHEN** the global configuration file does not exist
- **THEN** startup creates it from the canonical image baseline before LeanCTX services run

#### Scenario: Existing user configuration on restart

- **WHEN** the global configuration file exists with user values
- **THEN** container startup preserves those values and starts LeanCTX using them

### Requirement: Structured schema Save, Reset, and Validate

The Admin UI SHALL edit the global configuration exclusively through schema-driven structured fields with default badges, and SHALL provide Save (persist to the global config), Reset (restore schema defaults derived from the baseline), and Validate (run `lean-ctx config validate`). Saving a value that cannot be written because the existing file is malformed SHALL fail with HTTP 409 until Reset repairs the file.

#### Scenario: Save persists a structured edit

- **WHEN** an administrator changes a field and selects Save Changes
- **THEN** the global configuration stores the new value and reloading the page shows it

#### Scenario: Malformed global config blocks Save and offers Reset

- **WHEN** the global configuration file is malformed TOML and the administrator saves
- **THEN** the save is rejected with HTTP 409 and the UI reports that the configuration requires repair
- **AND** Reset restores the baseline and repairs the file

#### Scenario: Validate reports schema conformance

- **WHEN** the administrator selects Validate Config
- **THEN** the UI reports whether the edited values pass `lean-ctx config validate`

### Requirement: Apply runs lean-ctx config apply without container recreation

Apply SHALL run `lean-ctx config apply` in ai-dev and report its result. Apply MUST NOT restart or recreate the ai-dev container and MUST NOT sleep or poll; the lean-ctx CLI owns the daemon restart.

#### Scenario: Apply succeeds without container recreation

- **WHEN** the administrator selects Apply Saved Config with a saved configuration
- **THEN** `lean-ctx config apply` runs, the LeanCTX daemon process is restarted by the CLI
- **AND** the ai-dev container start time is unchanged

#### Scenario: Apply failure is reported

- **WHEN** `lean-ctx config apply` exits non-zero
- **THEN** the UI reports the failure output and no lifecycle action occurs

### Requirement: Local dirty and saved UI state

The Admin UI SHALL track edits locally: Apply SHALL be unavailable while there are unsaved changes, and SHALL become available after a successful Save. The UI SHALL NOT fetch status or drift endpoints to derive this state.

#### Scenario: Unsaved edits cannot be applied

- **WHEN** the operator changes a field without saving
- **THEN** Apply is disabled and the help text instructs the operator to save first

#### Scenario: Saved state re-enables Apply

- **WHEN** a Save succeeds
- **THEN** Apply becomes enabled and the status text confirms the saved state

### Requirement: Explicit compression restore migration

The system MUST support a one-time, versioned migration that restores the default compression level after an upstream LeanCTX defect is fixed. The migration MUST run only when the current value is `off`, MUST set compression explicitly to `lite` (the packaged baseline default), MUST create a versioned backup before changing the value, and MUST preserve unrelated configuration values. It MUST NOT auto-apply or restart services.

#### Scenario: Eligible migration

- **WHEN** the versioned migration marker is absent and compression is `off`
- **THEN** a versioned backup is created, compression becomes `lite`, unrelated values remain unchanged, and apply or restart remains administrator initiated

#### Scenario: Migration is already complete or ineligible

- **WHEN** the marker exists or compression is already `lite`, `standard`, or `max`
- **THEN** no migration or backup is performed
