## Context

The agent-connection-module change defines the v1 wire protocol between the
agent (ai-admin) and the Center Server: `hello`/`hello_ack`, `heartbeat`,
`command`, `ack`, `error`. Commands are limited to three actions (`upgrade`,
`reconfigure`, `restart`) and `ack` reports outcome only — no data channel, no
stream channel. See proposal.md for motivation; the v1 protocol contract is in
the agent-connection-module change's `center-protocol` and `agent-command`
specs.

## Goals / Non-Goals

**Goals:**
- Open a query channel: center sends read-only `command` messages naming a
  query, and the agent answers with `result` carrying data
- Open a stream channel: agent pushes `event` messages (upgrade progress proxy)
- Keep the catalog extension additive — no existing message type or semantics
  changes
- Reuse existing read paths (`/api/status` fields, `readEnvFile()`,
  `listProjects()`, `collectProvidersMeta()`) — no duplicated logic

**Non-Goals:**
- Action-command expansion beyond the three existing ones (project create,
  git-remote writes, provider key mutation) — deferred to a later change
- Center-side RBAC (authorization layering) — belongs to the future Center
  Server implementation, outside this protocol
- Agent-side command whitelist — rejected by design (see D4)
- Streaming of arbitrary long-lived channels beyond `event` messages

## Decisions

### D1: New `result` and `event` message types (Option B)

Query responses use a dedicated `result` type; `ack` stays outcome-only for
actions. `event` carries streamed operation events.

The base change's `Envelope` is the shared wire shape. Its `type` field is
defined by the `center-protocol` Message catalog; this change adds `result` and
`event` to that catalog. A `result` echoes the query command's envelope `id`.

Rationale:
- **Option A (extend `ack` with `data`) rejected**: mixes outcome semantics
  (success/failure) with query data, forcing receiver-side branch logic; the
  two have different lifetimes (outcome is terminal, result is a response)
- A dedicated `result` keeps `ack`/`error` correlation rules untouched (see
  center-protocol spec — acks/errors/hello_ack echo ids)

### D2: protocol_version stays 1 — types added within the version

`hello` continues to carry `protocol_version: 1`; `result` and `event` are
added to the message catalog of the same version.

Rationale:
- Version numbers exist to gate incompatible changes between *deployed*
  parties; nothing is implemented or deployed yet, so there is no fleet to
  migrate and no compatibility matrix to maintain
- The first shipping protocol simply includes `result`/`event`; a future
  change that adds incompatible behavior can bump to 2 then, when a real
  installed base justifies the negotiation machinery
- Avoiding a speculative version boundary removes the fictional
  "upgrade center and agent together" migration chore

### D3: Query commands are read-only, reuse existing read paths

`status`, `env.get`, `projects.list`, `providers.list` map onto existing admin
read logic. Route-local helpers must be extracted or exported behind a shared
read-only interface before the agent handlers consume them:

| Query | Backing read path |
|-------|-------------------|
| `status` | `/api/status` field assembly, including the base `StatusReport` fields |
| `env.get` | `readEnvFile()` from `src/admin/lib/env.ts` |
| `projects.list` | `listProjects()` + `checkFeature()` + disabled-state and git-remote reads from `src/admin/routes/projects.ts` |
| `providers.list` | `collectProvidersMeta()` from `src/admin/routes/providers.ts` |

Rationale:
- Zero new state; queries are side-effect free by construction when they only
  call read paths
- Masking helper `maskKey()` already exists in `src/admin/lib/provider-keys.ts`;
  the env redaction helper is new code and SHALL use the existing environment
  schema's password-typed keys.

### D4: No agent-side command whitelist — mutual authentication is the trust boundary

The agent trusts its authenticated center: the agent's operator chose the
`CENTER_URL` (with token), TLS verifies the center's identity, and the center
validates the agent's token. Within that mutually authenticated channel, the
agent executes any catalog command. Authorization (who may issue what to which
agent) is the center's own RBAC concern, not the wire protocol's.

Rationale:
- Whitelisting defended against center-credential compromise and center-side
  human error; both are out of scope for a self-hosted fleet tool where the
  center is the operator's own management plane
- Blast-radius mitigation belongs to per-agent tokens (one token opens one
  agent), which the v1 registration already supports
- An optional `AGENT_ALLOWED_COMMANDS` env policy can be added later without
  protocol changes if the threat model changes

### D5: `result` payloads mask key material by contract

The `result` type carries a masking contract: no raw API keys, tokens, or
passwords. Enforced at the payload-construction boundary, not at the caller.

Rationale:
- Key registry (`provider-keys.json`) holds plaintext keys; `providers.list`
  must return them masked only (`maskKey()`)
- Env secrets (`ADMIN_PASSWORD`, `OPENCHAMBER_UI_PASSWORD`,
  `OPENCODE_SERVER_PASSWORD`, provider keys, and tokens) are redacted/omitted
  in `env.get`; non-secret values remain readable.
- A protocol-level rule (spec) makes masking non-negotiable per implementation

### D6: `event` messages are unacknowledged, ordered

`event` is fire-and-forget, delivered in order while the connection is active,
and requires no ack. The agent reuses `subscribe()` from
`src/admin/lib/upgrade.ts`: it registers one subscriber per active connection
while an upgrade is running, removes it on disconnect and on terminal upgrade
event, and does not replay events missed during disconnection. A reconnect
resumes from the next emitted event; history remains available through
`GET /api/upgrade/log?history=1`.

Rationale:
- Ack-ing every event doubles message traffic for little value; the existing
  heartbeat already serves as the connection liveness signal
- Upgrade progress is replayable via `GET /api/upgrade/log?history=1` on the
  agent's local API — events are a live proxy, history is a separate query

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `result` payload leaking key material | Masking contract in the spec + `maskKey()` reuse at the payload boundary |
| Event flood (chatty upgrade logs) | Events mirror the bounded upgrade event log (step/status/message), same cadence as local SSE |
| Query handlers drift from admin API behavior | Queries call the same read functions the admin routes use; tests cover both surfaces |
| No center exists yet to consume the protocol | Protocol and agent side are fully specified and testable against a stub center (same as the base module) |

## Migration Plan

1. Land after `agent-connection-module` is implemented and archived —
   `result`/`event` are part of the same protocol version (`1`), so no
   coordinated version upgrade is required
2. Rollback: revert the agent to the pre-extension catalog; `result`/`event`
   simply go unused, no protocol regression
