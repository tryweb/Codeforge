## ADDED Requirements

### Requirement: Dashboard displays current .env contents

The ai-admin dashboard SHALL display all key-value pairs from the host `.env` file, with sensitive values (passwords, tokens) masked by default.

#### Scenario: View .env on dashboard load
- **WHEN** user opens the ai-admin dashboard
- **THEN** the .env section shows all configured keys with their values
- **AND** password/secret fields display as `******` with a reveal toggle

#### Scenario: Empty .env file
- **WHEN** the .env file is empty or missing
- **THEN** the dashboard shows a message "No .env file found" and provides a button to create one from the default template

### Requirement: User can edit .env values

The dashboard SHALL provide an inline form to modify .env variable values.

#### Scenario: Edit a single variable
- **WHEN** user clicks "Edit" on an .env variable
- **THEN** an inline editor opens with the current value pre-filled
- **AND** the key name is displayed but read-only (keys cannot be renamed)
- **AND** validation rules for that key are shown below the input
- **AND** the variable's apply tier is displayed (see variable tiers requirement)

#### Scenario: Save edits (Tier 1 — immediate)
- **WHEN** user submits a Tier 1 variable (e.g., `ADMIN_PASSWORD`)
- **THEN** the .env file is updated atomically (write to temp file, then rename)
- **AND** a success toast is displayed: "Saved and applied"
- **AND** an info note explains: "This change takes effect immediately for new requests"

#### Scenario: Save edits (Tier 2 — restart required)
- **WHEN** user submits a Tier 2 variable (e.g., `OPENCHAMBER_UI_PASSWORD`, `OPENCODE_SERVER_PASSWORD`)
- **THEN** the .env file is updated atomically
- **AND** an "Apply Now" button appears: "Restart ai-dev to apply (2-3s)"
- **AND** clicking "Apply Now" executes `docker compose up -d ai-dev` via Docker socket
- **AND** ai-admin container is NOT affected during restart
- **AND** a progress indicator shows restart status

#### Scenario: Save edits (Tier 3 — full down/up required)
- **WHEN** user submits a Tier 3 variable (e.g., `CHAMBER_PORT`, `WORKSPACE_PATH`)
- **THEN** the .env file is updated atomically
- **AND** a warning is displayed: "This change requires a full container restart"
- **AND** instructions are shown: "Run this command on the host: docker compose down && docker compose up -d"
- **AND** a "Restart Everything" button is available with a confirmation dialog warning of downtime

#### Scenario: Invalid value rejected
- **WHEN** user submits a value that fails validation (e.g., non-numeric port)
- **THEN** the save is rejected
- **AND** an error message describing the validation failure is shown
- **AND** the .env file is NOT modified

### Requirement: Variable tier classification

The dashboard SHALL classify each known .env variable into one of three apply tiers and display the tier information alongside the editor.

#### Scenario: Tier 1 — immediate effect
- **WHEN** user opens the editor for `ADMIN_PASSWORD`
- **THEN** the editor shows: "Tier 1: Takes effect immediately"
- **WHEN** `ADMIN_PASSWORD` is saved
- **THEN** the auth middleware reads the new value from `.env` on the next login request
- **AND** existing sessions remain valid until their cookie expires or browser closes

#### Scenario: Tier 2 — service restart
- **WHEN** user opens the editor for `OPENCHAMBER_UI_PASSWORD`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_PROVIDER`, or `OPENCODE_PLUGINS`
- **THEN** the editor shows: "Tier 2: Requires service restart to apply"
- **AND** an "Apply Now" button is available that calls `docker compose up -d ai-dev`
- **AND** ai-admin continues running during the restart

#### Scenario: Tier 3 — full infrastructure change
- **WHEN** user opens the editor for `CHAMBER_PORT`, `WORKSPACE_PATH`, `BACKUP_RETENTION`
- **THEN** the editor shows: "Tier 3: Requires container recreation"
- **AND** a note explains: "This changes the Docker Compose configuration and requires a full restart"

### Requirement: Variable validation by key

The dashboard SHALL maintain a schema per known .env key with type, allowed values, and optional regex validation.

#### Scenario: Port validation
- **WHEN** user edits `CHAMBER_PORT`
- **THEN** the input only accepts numeric values in the range 1024-65535

#### Scenario: Boolean validation
- **WHEN** user edits a boolean-typed variable
- **THEN** the input is rendered as a toggle switch (true/false)

#### Scenario: Unknown key
- **WHEN** user edits a key not in the schema
- **THEN** a plain text input is shown with no validation

#### Cross-cutting: ai-dev unavailable
- **WHEN** ai-dev container is not running (container_status != "running")
- **THEN** the entire .env section is disabled: "ai-dev container is not running"
- **AND** all exec-dependent operations and .env apply are blocked
- **AND** a global banner at the top of the dashboard explains the situation
