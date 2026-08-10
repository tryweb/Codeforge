## MODIFIED Requirements

### Requirement: Commands are parsed and routed to handlers

The agent SHALL accept `command` messages from the Center Server and route each
to the handler named by the `type` field in the command payload. Action command
types are `upgrade`, `reconfigure`, and `restart`; action outcomes SHALL be
reported with `ack`. Query command types are `status`, `env.get`,
`projects.list`, and `providers.list`; query outcomes SHALL be reported with
`result` and SHALL NOT produce an `ack`. Any other command type SHALL be
rejected with an `error` using code `unknown_command` and SHALL have no side
effects.

#### Scenario: Known action command is routed
- **WHEN** a `command` message whose payload type is `upgrade`, `reconfigure`, or `restart` is received
- **THEN** the corresponding action handler is invoked with the command payload
- **AND** the outcome is reported with `ack`

#### Scenario: Known query command is routed
- **WHEN** a `command` message whose payload type is `status`, `env.get`, `projects.list`, or `providers.list` is received
- **THEN** the corresponding read-only handler is invoked with the command payload
- **AND** the outcome is reported with `result`
- **AND** no `ack` is sent

#### Scenario: Unknown command is rejected
- **WHEN** a command message names a type outside the action and query command sets
- **THEN** the agent responds with an `error` (code `unknown_command`)
- **AND** no handler is invoked and no state is modified

## ADDED Requirements

### Requirement: Query commands are routed to read-only handlers

The agent SHALL route query commands — `status`, `env.get`, `projects.list`, `providers.list` — to their corresponding read-only handlers and answer each with a `result` message (see `center-protocol`). Query handlers SHALL reuse the existing read paths used by the local admin API and SHALL NOT mutate state. Route-local read helpers SHALL be extracted or exported behind a shared read-only interface before agent handlers consume them.

#### Scenario: status query is answered
- **WHEN** a `command` message with payload type `status` is received
- **THEN** the handler assembles the current status fields (container state, versions, auth status)
- **AND** the result payload contains `container_status`, `uptime_seconds`, `versions`, `gh_auth`, `glab_auth`, `admin_version`, `admin_version_mismatch`, and `upgrade_state`
- **AND** the agent sends a `result` carrying those fields

#### Scenario: env.get query is answered
- **WHEN** a `command` message with payload type `env.get` is received
- **THEN** the agent sends a `result` carrying the requested environment variables as a key/value map
- **AND** password-typed keys from the existing environment schema are redacted
- **AND** key material is masked or omitted

#### Scenario: projects.list query is answered
- **WHEN** a `command` message with payload type `projects.list` is received
- **THEN** the agent sends a `result` carrying project entries shaped as `{ features: { knowledge, maintenance, openspec }, remote, disabled }`

#### Scenario: providers.list query is answered
- **WHEN** a `command` message with payload type `providers.list` is received
- **THEN** the agent sends a `result` carrying provider metadata including `registry.keys[]`
- **AND** each registry key exposes only its masked value (first 4 + last 4 characters, or redacted for short values)

#### Scenario: Query commands have no side effects
- **WHEN** any query command is executed
- **THEN** no files, environment variables, or container state are modified
