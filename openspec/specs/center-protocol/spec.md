## Purpose

Defines the shared wire protocol between the ai-admin agent and the Center Server: registration, the hello handshake, the message catalog, ack/error correlation, command outcome reporting, reserved error codes, heartbeat keepalive semantics, and center-side offline queuing. Agent-side obligations are implemented by the agent module; Center Server obligations are the contract a future Center Server must implement.

## Requirements

### Requirement: Registration via authenticated connection

The agent SHALL register with the Center Server by connecting to the configured Center URL that carries its registration token (e.g., `wss://center.example.com/ws?token=<token>`). The token SHALL be presented during the WebSocket handshake; when the Center Server validates it, the connection is the registered, authenticated channel for all subsequent communication. When the token is not embedded in the URL, the `CENTER_TOKEN` environment variable SHALL be used instead.

#### Scenario: Register with token embedded in the Center URL
- **WHEN** the agent connects to a `CENTER_URL` that embeds the token (e.g., a `?token=` query parameter)
- **THEN** the token is presented during the WebSocket handshake
- **AND** if the Center Server validates the token, the connection proceeds as the registered, authenticated channel

#### Scenario: Token via CENTER_TOKEN environment variable
- **WHEN** `CENTER_URL` does not embed a token but `CENTER_TOKEN` is set
- **THEN** the agent presents the `CENTER_TOKEN` value during the handshake instead

#### Scenario: Authentication fails
- **WHEN** the Center Server rejects the token (missing or invalid)
- **THEN** the connection is not established
- **AND** the agent records the rejection and retries with the reconnect backoff

### Requirement: Agent identifies itself with a hello handshake

After the authenticated connection is established, the agent SHALL send a `hello` message as its first message, carrying `agent_id` and `protocol_version`. The agent SHALL NOT send heartbeats or commands until the Center Server acknowledges with `hello_ack`. The `agent_id` SHALL come from the `AGENT_ID` environment variable, falling back to the container hostname when unset.

#### Scenario: Hello is the first message on connect
- **WHEN** the authenticated WebSocket connection opens
- **THEN** the agent sends a `hello` message as the first message
- **AND** the hello payload contains `agent_id` and `protocol_version`
- **AND** no heartbeat or other message is sent before the `hello_ack`

#### Scenario: agent_id resolution
- **WHEN** `AGENT_ID` is set
- **THEN** the hello carries that value as `agent_id`
- **AND** when `AGENT_ID` is unset, the container hostname is used instead

#### Scenario: Center acknowledges the registration
- **WHEN** the Center Server accepts the hello
- **THEN** it responds with `hello_ack`
- **AND** normal message flow (heartbeat, commands) begins after that

### Requirement: Protocol versioning

Every `hello` SHALL carry the protocol version (`1` for this change). The Center Server SHALL reject hellos with a version it does not support.

#### Scenario: Supported protocol version
- **WHEN** the Center Server receives a hello with a supported `protocol_version`
- **THEN** it responds with `hello_ack`

#### Scenario: Unsupported protocol version
- **WHEN** the Center Server receives a hello with an unsupported `protocol_version`
- **THEN** it responds with an `error` (code `unsupported_version`) and closes the connection
- **AND** the agent logs the rejection and continues with the reconnect backoff

### Requirement: Message catalog

All communication SHALL use the JSON envelope with one of the following message types, sent only in the direction shown. The `command` type's payload names a command whose type is one of the action or query commands below.

| Type | Direction | Sender | Purpose | Payload |
|------|-----------|--------|---------|---------|
| `hello` | → | Agent | Register and identify on connect | `agent_id`, `protocol_version` |
| `hello_ack` | ← | Center | Accept registration | — |
| `heartbeat` | → | Agent | Periodic status report (60s) | `StatusReport` |
| `ack` | ← | Center | Heartbeat acknowledgement (advisory) | — |
| `command` | ← | Center | Dispatch remote command — action or query | command name + parameters |
| `ack` | → | Agent | Command outcome report (actions) | `status`, `message`, `started_at`, `finished_at`, optional `data` |
| `result` | → | Agent | Query response data | requested data (key material masked) |
| `event` | → | Agent | Streamed operation events | event name + payload |
| `error` | ⇄ | Either | Protocol-level failure | `code`, `message` |

The action command set SHALL be: `upgrade`, `reconfigure`, `restart`,
`providers.key.add`, `providers.key.set-active`, `providers.key.delete`,
`providers.key.update-note`, `secrets.set`, `ssh.key.add`, `ssh.key.delete`,
`git.config.set`, `gh.auth.start`, `gh.auth.logout`, `glab.instance.add`,
`glab.instance.remove`, `projects.create`, `projects.set-remote`,
`projects.enable`, `projects.disable`, `projects.enable-feature`, and
`projects.sync`. The query command set SHALL be: `status`, `env.get`,
`projects.list`, `providers.list`, `git.config.get`, `glab.instances`, and
`ssh.key.list`.

#### Scenario: Message type and direction
- **WHEN** the agent or Center Server sends a message
- **THEN** it uses one of the types above, in the allowed direction

#### Scenario: Unknown message type
- **WHEN** a message arrives with a type outside the catalog
- **THEN** the receiver responds with an `error` (code `malformed_message`) and ignores the message

### Requirement: Provider key commands carry plaintext key material in the command payload only

The `providers.key.add` command payload SHALL carry the raw provider API key.
No `ack`, `result`, `event`, or `error` message SHALL contain a plaintext key
value; key-bearing response fields SHALL be masked (`maskKey`: first 4 + last
4 characters) or replaced with key ids. Logs and error messages SHALL NOT
include key values.

#### Scenario: add command carries the plaintext key
- **WHEN** the center sends `providers.key.add` with a `value` field
- **THEN** the plaintext key is present in that command payload only

#### Scenario: ack does not echo the key
- **WHEN** the agent acknowledges a `providers.key.add` command
- **THEN** the ack payload contains no plaintext key value, only masked keys
  or the key id

#### Scenario: error messages do not leak key material
- **WHEN** a provider key command fails
- **THEN** the error message and its `ack` describe the failure without
  including the key value

### Requirement: Provider key commands are actions answered with ack

The agent SHALL answer `providers.key.add`, `providers.key.set-active`,
`providers.key.delete`, and `providers.key.update-note` with `ack` messages
using the two-ack outcome pattern (accepted/starting, then final outcome),
and SHALL NOT send a `result` for them.

#### Scenario: key command is acked
- **WHEN** a provider key command completes
- **THEN** the agent sends an `ack` whose envelope `id` equals the command's
  `id`

#### Scenario: final ack reports the restart mode used
- **WHEN** a `providers.key.set-active` or `providers.key.delete` command
  triggers a restart
- **THEN** the final ack message states which restart mode was actually used
  (`graceful` or `force`, including a force fallback after a graceful-wait
  timeout)

### Requirement: Acknowledgements correlate by message id

An `ack`, `error`, or `hello_ack` SHALL carry, in its envelope `id`, the id of the message being acknowledged — the `hello_ack` echoes the `hello`'s id. A command's envelope id SHALL be preserved while queued, so its eventual ack still correlates end-to-end.

#### Scenario: Ack references the original message id
- **WHEN** the agent or Center Server acknowledges a message
- **THEN** the ack's envelope `id` equals the acknowledged message's `id`

#### Scenario: hello_ack echoes the hello id
- **WHEN** the Center Server acknowledges a `hello`
- **THEN** the `hello_ack`'s envelope `id` equals the `hello`'s `id`

#### Scenario: Correlation survives command deferral
- **WHEN** a command is deferred in the agent-side deferral queue
- **THEN** the queued command keeps its original envelope id
- **AND** the ack sent after execution uses that same id

### Requirement: Command outcomes are reported via ack

The agent SHALL report the outcome of an executed command with an `ack` whose payload carries `status` (`success` or `failure`) and a human-readable `message`, plus `started_at`/`finished_at` timestamps. Protocol-level problems (malformed messages, unknown commands, version/auth failures) are reported with `error` instead, and are not command outcomes. An `ack` payload MAY additionally carry a `data` object for commands whose outcome includes machine-readable material that the center must relay to the operator — currently only `gh.auth.start`, whose `data` carries the device-flow code and verification URI. The `data` field is additive: ack consumers SHALL accept acks with or without it, and `data` SHALL NOT contain plaintext key material (PATs, passwords, API keys).

#### Scenario: Command succeeds
- **WHEN** a command executes successfully
- **THEN** the agent sends an `ack` with `status: "success"` and a completion `message`
- **AND** the ack carries the command's envelope id

#### Scenario: Command fails during execution
- **WHEN** a command is executed but fails (e.g., `runUpgrade()` reports failure)
- **THEN** the agent sends an `ack` with `status: "failure"` and a message describing the error

#### Scenario: Protocol errors are not command outcomes
- **WHEN** a message is rejected before execution (malformed, unknown type, unsupported version)
- **THEN** the receiver responds with an `error`, not an `ack` with status

#### Scenario: Device-flow ack carries machine-readable data
- **WHEN** a `gh.auth.start` command completes
- **THEN** the final ack's payload carries a `data` object with the device code and verification URI
- **AND** the operator can enter the code at the URI to complete authentication

#### Scenario: Other acks omit data
- **WHEN** any command other than `gh.auth.start` is acknowledged
- **THEN** the ack payload contains no `data` field

### Requirement: Error codes

Every `error` SHALL carry a `code` and a `message`. Reserved codes: `malformed_message`, `unknown_command`, `malformed_command`, `unsupported_version`, `auth_failed`. Receivers SHALL ignore unrecognized error codes for forward compatibility.

#### Scenario: Error payload shape
- **WHEN** a side sends an `error`
- **THEN** the payload contains a reserved `code` and a human-readable `message`

#### Scenario: Unrecognized error code
- **WHEN** an `error` arrives with a code outside the reserved set
- **THEN** the receiver logs it and does not fail or retry differently

### Requirement: Heartbeat doubles as keepalive with stale detection

The Center Server SHALL treat the heartbeat as the agent's keepalive and SHALL consider an agent offline after 3 consecutive missed heartbeat intervals (~180s at the 60s interval). Heartbeat acknowledgements are advisory: the agent SHALL NOT resend heartbeats when an ack is missing.

#### Scenario: Stale agent detection
- **WHEN** the Center Server receives no heartbeat from an agent for 3 consecutive intervals
- **THEN** the center marks the agent offline

#### Scenario: Missing heartbeat ack is tolerated
- **WHEN** the Center Server does not ack a heartbeat
- **THEN** the agent continues sending heartbeats on schedule and does not resend

### Requirement: Center-side offline command queue

The Center Server SHALL be allowed to queue commands for an agent with no live connection and SHALL flush them only after the agent's registration is acknowledged (`hello_ack`). The agent SHALL accept and execute flushed commands like any other command.

#### Scenario: Commands queued while agent offline
- **WHEN** the Center Server receives a command for an agent with no live connection
- **THEN** the center queues the command for that agent

#### Scenario: Queue flushed after registration
- **WHEN** the agent reconnects and its hello is acknowledged
- **THEN** the center sends the queued commands
- **AND** the agent executes them in the order received

### Requirement: Query commands are answered with result

The agent SHALL answer a read-only query command (`status`, `env.get`, `projects.list`, `providers.list`) with a `result` message whose envelope `id` equals the query command's `id`, and SHALL NOT send an `ack` for a query command. Query commands SHALL have no side effects on files, env, or container state.

#### Scenario: result correlates to the query
- **WHEN** the agent executes a query command
- **THEN** it sends a `result` whose envelope `id` equals the query command's `id`

#### Scenario: Query commands are not acked
- **WHEN** a query command completes
- **THEN** no `ack` is sent for it

### Requirement: result payloads mask key material

A `result` payload SHALL NOT contain raw API keys, tokens, or passwords. Key-bearing fields SHALL be returned masked (first 4 + last 4 characters, or redacted) or omitted.

#### Scenario: providers.list result masks keys
- **WHEN** a `providers.list` query is answered
- **THEN** registry keys are masked (first 4 + last 4 characters) and no raw key value is present in the payload

#### Scenario: env.get result redacts secrets
- **WHEN** an `env.get` query is answered
- **THEN** values of password/secret keys are redacted or omitted from the payload

### Requirement: Event messages stream operation events

The agent SHALL send `event` messages to the Center Server for streamable operations (e.g., upgrade progress). Each `event` SHALL carry an event name and a payload describing the event; events SHALL be delivered in order and SHALL NOT require an acknowledgement.

#### Scenario: Upgrade progress is streamed as events
- **WHEN** an upgrade is running
- **THEN** the agent sends `event` messages carrying the upgrade step, status, message, and timestamp

#### Scenario: Events are not acknowledged
- **WHEN** the agent sends an `event`
- **THEN** it does not wait for or require an acknowledgement, and does not resend on missing acks

#### Scenario: Upgrade events are subscribed while connected
- **WHEN** an upgrade is running while the agent connection is established
- **THEN** the agent has one active subscriber to the upgrade event stream for that connection
- **AND** each newly emitted upgrade event is sent as one `event` envelope

#### Scenario: Upgrade event subscription is cleaned up
- **WHEN** the agent disconnects or the upgrade reaches a terminal state
- **THEN** the agent removes the active upgrade event subscriber
- **AND** a reconnect does not create duplicate subscribers

#### Scenario: Events missed during disconnection are not replayed
- **WHEN** upgrade events are emitted while the agent is disconnected
- **THEN** those live events are not replayed after reconnect
- **AND** the next connected event resumes the stream in order
- **AND** historical events remain available through the local upgrade history query

### Requirement: Remote management commands carry secret material in the command payload only

Command payloads SHALL be the only place plaintext secret material — personal access tokens, passwords, SSH key passphrases, and device-flow codes — travels. The `glab.instance.add` command SHALL carry the GitLab personal access token in its payload; the `secrets.set` command SHALL carry the new secret value in its payload. No `ack`, `result`, `event`, or `error` message SHALL echo a plaintext secret; secret-bearing response fields SHALL be masked (`maskKey`: first 4 + last 4 characters, or bullet-only for short values) or replaced with non-secret identifiers. Logs and error messages SHALL NOT include secret values. Device-flow codes are short-lived credentials and SHALL be treated as secret material: masked in logs and omitted from every message except the `gh.auth.start` ack `data` that delivers them to the center.

#### Scenario: GitLab PAT travels in the add payload only
- **WHEN** the center sends `glab.instance.add` with a `token` field
- **THEN** the plaintext token is present in that command payload only
- **AND** the ack payload contains no token value

#### Scenario: Secrets are never echoed
- **WHEN** the agent acknowledges a `secrets.set` command
- **THEN** the ack payload contains no plaintext secret value
- **AND** the ack reports only the key name and activation status

#### Scenario: Device codes are not logged
- **WHEN** a `gh.auth.start` command is processed
- **THEN** agent logs describe the flow without including the device code
- **AND** the code appears only in the ack `data` delivered to the center

#### Scenario: SSH passphrases are not logged
- **WHEN** a `ssh.key.add` command carries a passphrase
- **THEN** the passphrase is present in the command payload only
- **AND** agent logs and the ack describe the outcome without including it

#### Scenario: error messages do not leak secret material
- **WHEN** a remote management command fails
- **THEN** the error message and its `ack` describe the failure without including the secret value
