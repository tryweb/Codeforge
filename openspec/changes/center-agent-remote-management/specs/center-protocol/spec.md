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

## ADDED Requirements

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
