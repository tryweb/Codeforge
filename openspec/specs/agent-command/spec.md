## Purpose

Defines command dispatch on the ai-admin agent: parsing and routing of `command` messages from the Center Server to the `upgrade`, `reconfigure`, and `restart` handlers, and the in-memory FIFO deferral queue that holds commands blocked by an in-progress upgrade or a dropped connection.
## Requirements

> **Container naming.** The agent module operates in the production environment only. Compose services `ai-dev` and `ai-admin` correspond to the production containers `ai-engkit` and `ai-engkit-admin`. The test/dev containers (`ai-engkit-dev`, `ai-engkit-admin-dev`) are used only while developing or testing the module itself; the existing sibling-name convention (`getSiblingDevContainerName`) derives the correct container from the admin container's own name, so a development run targets the dev containers and never production.

### Requirement: Commands are parsed and routed to handlers

The agent SHALL accept `command` messages from the Center Server and route each
to the handler named by the `type` field in the command payload. Action command
types are `upgrade`, `reconfigure`, `restart`, `providers.key.add`,
`providers.key.set-active`, `providers.key.delete`, and
`providers.key.update-note`; action outcomes SHALL be reported with `ack`.
Query command types are `status`, `env.get`, `projects.list`, and
`providers.list`; query outcomes SHALL be reported with `result` and SHALL NOT
produce an `ack`. Any other command type SHALL be rejected with an `error`
using code `unknown_command` and SHALL have no side effects.

#### Scenario: Known action command is routed
- **WHEN** a `command` message whose payload type is an action command is received
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

### Requirement: Provider key commands mutate the shared key registry

The agent SHALL route `providers.key.add`, `providers.key.set-active`,
`providers.key.delete`, and `providers.key.update-note` to handlers that
mutate the shared `provider-keys.json` registry through the same library
functions the local admin API uses, restricted to key-managed providers
(`isKeyProviderSupported()`, initially `opencode-go`). A command naming any
other provider SHALL be rejected with `error` `malformed_command` before any
mutation.

#### Scenario: add a key
- **WHEN** a `providers.key.add` command with a valid provider, a non-empty
  `value`, and an optional `note` is received
- **THEN** the key is appended to the registry
- **AND** the current active selection is unchanged
- **AND** if it is the provider's first key, the key is applied to the auth
  store and ai-dev is restarted per the command's restart mode

#### Scenario: add rejects an empty key
- **WHEN** a `providers.key.add` command carries an empty or non-string `value`
- **THEN** no registry change is made and an `error` (`malformed_command`) is sent

#### Scenario: first-key add rejects an unknown auth-store credential
- **WHEN** the registry has no keys for the provider but the ai-dev auth store
  already holds a key for it
- **THEN** the add is rejected with an `error` describing the collision, and
  no registry change is made

#### Scenario: update note
- **WHEN** a `providers.key.update-note` command names an existing key id and
  a string `note`
- **THEN** the key's note is updated in the registry
- **AND** no apply and no restart are performed

#### Scenario: set active key
- **WHEN** a `providers.key.set-active` command names an existing key id
- **THEN** the selection is persisted in the registry
- **AND** the key is applied to the ai-dev auth store
- **AND** ai-dev is restarted per the command's restart mode

#### Scenario: set-active rolls back on apply failure
- **WHEN** applying the selected key to the auth store or restarting fails
- **THEN** the previous active selection is restored in the registry
- **AND** an `ack` reporting the failure is sent

#### Scenario: delete a key
- **WHEN** a `providers.key.delete` command names an existing key id
- **THEN** the key is removed from the registry
- **AND** if the removed key was active, the next key is promoted and applied
  to the auth store, and ai-dev is restarted per the command's restart mode

#### Scenario: delete the last key
- **WHEN** a `providers.key.delete` command removes the provider's only key
- **THEN** the provider's entry is removed from the auth store, the provider
  cache is cleared, and ai-dev is restarted per the command's restart mode

#### Scenario: delete a non-active key
- **WHEN** a `providers.key.delete` command removes a key that is not active
- **THEN** the registry is updated
- **AND** no apply and no restart are performed

### Requirement: Key-change restarts respect a restart mode

`providers.key.set-active` and `providers.key.delete` SHALL accept a `mode`
field of `"graceful"` or `"force"`, defaulting to `"graceful"`. A `graceful`
restart SHALL wait until every non-archived OpenChamber session reports an
idle status (polled via the OpenChamber control API), then stop the ai-dev
container cleanly before recreation. A `force` restart SHALL recreate the
ai-dev container immediately, as the current restart behavior does. If a
graceful wait exceeds its deadline or the control API is unavailable, the
agent SHALL fall back to a force restart and report that in the final `ack`.

#### Scenario: graceful is the default
- **WHEN** a key-change command triggers a restart without a `mode` field
- **THEN** the agent waits for all sessions to be idle before restarting

#### Scenario: graceful waits for busy sessions
- **WHEN** a graceful restart is requested and at least one session reports a
  non-idle status
- **THEN** the agent keeps polling until all sessions report idle or the
  deadline is reached

#### Scenario: graceful deadline falls back to force
- **WHEN** sessions remain non-idle past the graceful-wait deadline
- **THEN** the agent performs a force restart
- **AND** the final `ack` states that the force fallback was used

#### Scenario: force restarts immediately
- **WHEN** a key-change command carries `mode: "force"`
- **THEN** the ai-dev container is recreated immediately without waiting

### Requirement: Provider key handlers reuse the shared registry and apply pipeline

Provider key handlers SHALL call the registry mutation and auth-store apply
functions exported from `src/admin/lib/provider-keys.ts` and
`src/admin/lib/opencode-auth.ts` — the same functions the local admin routes
use — and SHALL NOT reimplement registry or auth-store logic.

#### Scenario: shared mutation functions are used
- **WHEN** a provider key command executes
- **THEN** it calls the shared registry/apply library functions rather than
  duplicating their behavior

#### Scenario: agent handlers bind through CommandDeps
- **WHEN** the agent dispatcher is constructed
- **THEN** its dependencies bind the shared library functions so tests can
  inject fakes and the production wiring stays identical to the local paths

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

### Requirement: Upgrade command runs the existing upgrade pipeline

The `upgrade` command SHALL execute the existing `runUpgrade()` pipeline (pull latest image, backup, merge `.env`, recreate ai-dev, poll health, reconcile registrations, cleanup) and report the outcome.

#### Scenario: Upgrade succeeds
- **WHEN** an `upgrade` command completes successfully
- **THEN** an `ack` message reporting success is sent to the Center Server

#### Scenario: Upgrade fails
- **WHEN** `runUpgrade()` reports failure
- **THEN** an `ack` message reporting the failure is sent to the Center Server

#### Scenario: Upgrade already running
- **WHEN** an `upgrade` command arrives while an upgrade is already in progress
- **THEN** the command is deferred and executed after the running upgrade completes, following the agent-side deferral queue ordering

### Requirement: Reconfigure command updates env and restarts the ai-dev container

The `reconfigure` command SHALL write the supplied key/value pairs to `/opt/ai-engkit/.env` via the existing env library and restart the ai-dev container (`ai-engkit`) via the existing `restartAiDev()` flow, then report the outcome.

#### Scenario: Env values are updated and the ai-dev container restarted
- **WHEN** a `reconfigure` command with an `updates` object is received
- **THEN** each key is written to `.env`
- **AND** the ai-dev container is restarted (compose recreate in production, plain restart in dev/DooD)
- **AND** an `ack` message reporting success is sent

#### Scenario: Invalid reconfigure payload
- **WHEN** a `reconfigure` command lacks an `updates` object or contains non-string values
- **THEN** no change is made to `.env` and an `error` message is sent

### Requirement: Restart command restarts a container

The `restart` command SHALL restart the container named in the command payload. The payload names one of the two compose services, `ai-dev` or `ai-admin`, which the agent resolves to the production containers `ai-engkit` and `ai-engkit-admin` (via the sibling-name convention; a development run resolves to the dev containers instead). When the target is the admin container itself, the `ack` SHALL be sent before the restart executes so the outcome is not lost when the connection drops (response-first pattern).

#### Scenario: Restart the ai-dev container
- **WHEN** a `restart` command targeting `ai-dev` is received
- **THEN** the ai-dev container (`ai-engkit`) is restarted
- **AND** an `ack` message reporting the outcome is sent

#### Scenario: Restart the admin container (self-restart)
- **WHEN** a `restart` command targeting `ai-admin` is received
- **THEN** an `ack` message is sent first, and the admin container (`ai-engkit-admin`) is then restarted (recreate with the latest image, mirroring the existing admin restart endpoint)

#### Scenario: Unknown restart target
- **WHEN** a `restart` command names a target other than `ai-dev` or `ai-admin`
- **THEN** no restart is performed and an `error` message is sent

### Requirement: Commands are queued while execution is blocked

A command that cannot execute immediately — because an upgrade is in progress or the connection drops after receipt — SHALL be held in an in-memory FIFO deferral queue and executed in order once the blocking condition clears (upgrade completes or connection is re-established). The queue SHALL NOT survive an agent process restart.

#### Scenario: Command deferred during upgrade
- **WHEN** a command arrives while an upgrade is running
- **THEN** the command is queued, not executed
- **AND** after the upgrade completes, queued commands execute in FIFO order

#### Scenario: Queued commands survive a brief disconnection
- **WHEN** queued commands exist and the connection drops
- **THEN** the queue is retained
- **AND** after a successful reconnect, the queued commands execute in FIFO order

#### Scenario: Queue is lost on process restart
- **WHEN** the admin process restarts
- **THEN** any in-memory queued commands are discarded
