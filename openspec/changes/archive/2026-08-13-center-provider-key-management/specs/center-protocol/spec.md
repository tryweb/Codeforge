## MODIFIED Requirements

### Requirement: Message catalog

All communication SHALL use the JSON envelope with one of the following message types, sent only in the direction shown. The `command` type's payload names a command whose type is one of the action or query commands below.

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

The action command set SHALL be: `upgrade`, `reconfigure`, `restart`,
`providers.key.add`, `providers.key.set-active`, `providers.key.delete`,
`providers.key.update-note`. The query command set SHALL be: `status`,
`env.get`, `projects.list`, `providers.list`.

#### Scenario: Message type and direction
- **WHEN** the agent or Center Server sends a message
- **THEN** it uses one of the types above, in the allowed direction

#### Scenario: Unknown message type
- **WHEN** a message arrives with a type outside the catalog
- **THEN** the receiver responds with an `error` (code `malformed_message`) and ignores the message

## ADDED Requirements

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
