## Why

The agent-connection-module change establishes the v1 wire protocol, but the
center can only issue three action commands (`upgrade`, `reconfigure`,
`restart`) whose `ack` reports success/failure only — it cannot return data.
Centralized fleet management cannot reach admin parity: status, env vars,
project lists, and provider information are all unqueryable from the center.
This change opens the query and stream channels at the protocol level so the
center can both *inspect* an agent's state and *proxy* its event streams.

## What Changes

- **New message types added to the existing protocol**: `result` and `event`
  join the message catalog. `protocol_version` stays `1` — the version field
  is reserved for future incompatible changes once agents are deployed; with
  nothing deployed yet, the first shipping protocol simply includes these
  types.
- **New `result` message type** — request/response query channel. The center
  sends a `command` message naming a query; the agent replies with `result`
  carrying the requested data (as opposed to `ack`, which stays outcome-only).
- **New `event` message type** — stream channel. The agent pushes structured
  events to the center (e.g., upgrade progress log proxy).
- **New query commands**: `status`, `env.get`, `projects.list`,
  `providers.list` — read-only, no side effects.
- **Data masking rule**: `result` payloads MUST NOT contain raw key material
  (provider keys, tokens); key-bearing fields are returned masked only.
- **Trust model settled**: mutual authentication (agent→center token, center→agent
  TLS + operator-configured URL) is sufficient trust; NO agent-side command
  whitelist. Authorization layering belongs to the center's own RBAC, outside
  this protocol.

## Dependencies

This change depends on `agent-connection-module`. Its `center-protocol` and
`agent-command` deltas modify requirements introduced by that change, so
`agent-connection-module` SHALL be implemented and archived first. The query
protocol implementation follows in a later step; this change is not intended
to stand alone against the pre-agent base specs.

## Capabilities

### New Capabilities

- *(none — this change extends existing capabilities, no new capability paths)*

### Modified Capabilities

- `center-protocol`: add `result`/`event` message types with direction and
  payload contracts, query semantics, and the data-masking rule for `result`
  payloads (protocol version stays `1`).
- `agent-command`: add query command routing — `status`, `env.get`,
  `projects.list`, `providers.list` — dispatched to read-only handlers that
  reply via `result` (not `ack`), plus the envelope-id correlation carried
  through the query/result pair.

## Impact

- **`src/admin/agent/`** (from agent-connection-module): query command
  handlers, `result` envelope serialization, data-masking helper
- **`src/admin/`**: query handlers reuse existing read paths —
  `/api/status` fields, `readEnvFile()`, `listProjects()` +
  `checkFeature()`, `collectProvidersMeta()`
- **Dependencies**: none new — Bun stdlib WebSocket, no packages
- **Protocol compatibility**: the catalog extension is additive within version
  `1`; `result`/`event` are valid message types for all agents implementing
  this protocol
