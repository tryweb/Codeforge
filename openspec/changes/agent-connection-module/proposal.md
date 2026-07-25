## Why

ai-engkit deployments can span multiple hosts (developer workstations, build
servers, edge devices). Currently each instance is managed individually via
its local admin dashboard. There is no centralized view of fleet status or
way to issue commands (upgrade, reconfigure) across instances.

A centralized management layer — the Agent Connection Module — turns each
ai-admin instance into an agent that connects outbound to a Center Server,
enabling multi-instance visibility and remote command dispatch.

## What Changes

- **New outbound WebSocket client** in the ai-admin container, connecting to
  a configurable Center Server URL (`CENTER_URL` env var)
- **Exponential backoff reconnect** with jitter for resilience
- **Heartbeat protocol** — periodic status reports (container state, versions,
  auth status) every 60s
- **Command dispatch** — Center Server can send commands (upgrade, reconfigure,
  restart) which the agent executes locally
- **TLS mutual authentication** — optional mTLS for secure agent-to-center
  communication
- **Offline command queue** — commands received while disconnected are queued
  and executed on reconnect

## Capabilities

### New Capabilities

- `agent-connect`: Outbound WebSocket client with auto-reconnect to Center Server
- `agent-heartbeat`: Periodic status reporting (60s interval)
- `agent-command`: Remote command dispatch (upgrade, reconfigure, restart)
- `agent-security`: TLS mutual authentication for agent-center communication

### Modified Capabilities

*(None — this is a new subsystem, not modifying existing ones.)*

## Impact

- **`.env`**: new variable `CENTER_URL` (required for agent mode)
- **`src/admin/`**: new `agent/` directory — WebSocket client, heartbeat,
  command handler, TLS config
- **Image size**: minor increase (WebSocket client is stdlib in Bun)
- **Security**: outbound WebSocket only; no new inbound ports. Center Server
  must present a valid TLS certificate (or configure custom CA).
