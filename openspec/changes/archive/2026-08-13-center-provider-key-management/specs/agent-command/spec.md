## MODIFIED Requirements

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
- **WHEN** a `command` message whose payload type is a query command is received
- **THEN** the corresponding read-only handler is invoked with the command payload
- **AND** the outcome is reported with `result`
- **AND** no `ack` is sent

#### Scenario: Unknown command is rejected
- **WHEN** a command message names a type outside the action and query command sets
- **THEN** the agent responds with an `error` (code `unknown_command`)
- **AND** no handler is invoked and no state is modified

## ADDED Requirements

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
