## Why

ai-engkit deployments can span multiple hosts (developer workstations, build
servers, edge devices). Currently each instance is managed individually via
its local admin dashboard. There is no centralized view of fleet status or
way to issue commands (upgrade, reconfigure, restart) across instances.

A centralized management layer — the Agent Connection Module — turns each
ai-admin instance into an agent that connects outbound to a Center Server,
enabling multi-instance visibility and remote command dispatch.

## What Changes

- **New outbound WebSocket client** in the ai-admin container, connecting to
  a configurable Center Server URL (`CENTER_URL` env var)
- **Token-based registration** — the Center URL carries the registration token
  (or `CENTER_TOKEN` env var); a validated handshake registers the agent
- **Hello identity handshake** — `AGENT_ID` (or container hostname) +
  protocol version exchanged before traffic begins
- **Exponential backoff reconnect** with jitter for resilience
- **Heartbeat protocol** — periodic status reports (container state, versions,
  auth status) every 60s
- **Command dispatch** — Center Server can send commands (upgrade, reconfigure,
  restart) which the agent executes locally
- **TLS mutual authentication** — optional mTLS for secure agent-to-center
  communication
- **Command deferral queue** — commands blocked by an in-progress upgrade are
  held and executed in order; the Center Server queues commands for offline
  agents and flushes them after re-registration

### New Capabilities

- `agent-connect`: Outbound WebSocket client with auto-reconnect to Center Server
- `agent-heartbeat`: Periodic status reporting (60s interval)
- `agent-command`: Remote command dispatch (upgrade, reconfigure, restart)
- `agent-security`: TLS mutual authentication for agent-center communication
- `center-protocol`: Agent-Center wire protocol — token registration, hello
  identity handshake, message catalog, ack correlation, error codes, keepalive

### Modified Capabilities

*(None — this is a new subsystem, not modifying existing ones.)*

## Impact

- **`.env`**: new variables `CENTER_URL` (required for agent mode), `AGENT_ID`
  (falls back to container hostname), `CENTER_TOKEN` (used when not embedded in
  `CENTER_URL`), and optional mTLS cert vars `CENTER_CA_CERT`,
  `CENTER_CLIENT_CERT`, `CENTER_CLIENT_KEY`
- **`src/admin/`**: new `agent/` directory — WebSocket client, heartbeat,
  command handler, TLS config
- **Image size**: minor increase (WebSocket client is stdlib in Bun)
- **Security**: outbound WebSocket only; no new inbound ports. Center Server
  must present a valid TLS certificate (or configure custom CA).
