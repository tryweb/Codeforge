## MODIFIED Requirements

### Requirement: Message catalog

All communication SHALL use the JSON envelope with one of the following message types, sent only in the direction shown:

| Type | Direction | Sender | Purpose | Payload |
|------|-----------|--------|---------|---------|
| `hello` | → | Agent | Register and identify on connect | `agent_id`, `protocol_version` |
| `hello_ack` | ← | Center | Accept registration | — |
| `heartbeat` | → | Agent | Periodic status report (60s) | `StatusReport` |
| `ack` | ← | Center | Heartbeat acknowledgement (advisory) | — |
| `command` | ← | Center | Dispatch remote command — action or query | command name + parameters |
| `ack` | → | Agent | Command outcome report (actions) | `status`, `message`, `started_at`, `finished_at` |
| `result` | → | Agent | Query response data | requested data (key material masked) |
| `event` | → | Agent | Streamed operation events | event name + payload |
| `error` | ⇄ | Either | Protocol-level failure | `code`, `message` |

#### Scenario: Message type and direction
- **WHEN** the agent or Center Server sends a message
- **THEN** it uses one of the types above, in the allowed direction

#### Scenario: Unknown message type
- **WHEN** a message arrives with a type outside the catalog
- **THEN** the receiver responds with an `error` (code `malformed_message`) and ignores the message

## ADDED Requirements

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
