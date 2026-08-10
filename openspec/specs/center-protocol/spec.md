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

All communication SHALL use the JSON envelope with one of the following message types, sent only in the direction shown:

| Type | Direction | Sender | Purpose | Payload |
|------|-----------|--------|---------|---------|
| `hello` | → | Agent | Register and identify on connect | `agent_id`, `protocol_version` |
| `hello_ack` | ← | Center | Accept registration | — |
| `heartbeat` | → | Agent | Periodic status report (60s) | `StatusReport` |
| `ack` | ← | Center | Heartbeat acknowledgement (advisory) | — |
| `command` | ← | Center | Dispatch remote command | command name + parameters |
| `ack` | → | Agent | Command outcome report | `status`, `message`, `started_at`, `finished_at` |
| `error` | ⇄ | Either | Protocol-level failure | `code`, `message` |

#### Scenario: Message type and direction
- **WHEN** the agent or Center Server sends a message
- **THEN** it uses one of the types above, in the allowed direction

#### Scenario: Unknown message type
- **WHEN** a message arrives with a type outside the catalog
- **THEN** the receiver responds with an `error` (code `malformed_message`) and ignores the message

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

The agent SHALL report the outcome of an executed command with an `ack` whose payload carries `status` (`success` or `failure`) and a human-readable `message`, plus `started_at`/`finished_at` timestamps. Protocol-level problems (malformed messages, unknown commands, version/auth failures) are reported with `error` instead, and are not command outcomes.

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