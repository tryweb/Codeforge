## Context

This change extracts the Agent Connection Module from the ai-admin-dashboard
change. The architectural foundation is documented in that change's design.md
(see "Remote Agent Architecture" section). Key points:

- Agent-initiated outbound WebSocket (not center-initiated inbound)
- NAT/firewall friendly — only outbound TCP needed
- Designed for multi-instance fleet management

## Decisions

### D1: Bun-native WebSocket (no external dependency)

**Decision:** Use Bun's built-in `WebSocket` class. No `ws` npm package or
external dependency needed.

Rationale:
- Bun implements both WebSocket client and server natively
- One fewer dependency to version-pin
- Bun's WebSocket supports `ping`/`pong` for keepalive

### D2: JSON protocol with type field

**Decision:** All messages between agent and center use a JSON envelope:

```typescript
interface Envelope {
  type: string;
  payload: unknown;
  id: string;
  timestamp: string;
}
```

The allowed `type` values are defined by the `center-protocol` Message catalog.
Later protocol changes may extend that catalog additively; transport code SHALL
not maintain a second hard-coded list of message types.

Rationale:
- Simple to implement and debug
- No schema compilation step (compared to Protobuf)
- Center server can be implemented in any language

### D3: Exponential backoff with jitter

**Decision:** On disconnect, reconnect with exponential backoff:

```
Attempt 1: 1s
Attempt 2: 2s
Attempt 3: 4s
Attempt 4: 8s
...
Max: 300s (5 minutes)
+ random jitter ±25%
```

Rationale:
- Prevents thundering herd when Center Server recovers
- Bounded max interval prevents permanent black hole

### D4: Center URL from env var

**Decision:** `CENTER_URL` env var configures the WebSocket endpoint.
If unset, the agent module is disabled (no connection attempt).

```typescript
const CENTER_URL = process.env.CENTER_URL || "";
if (!CENTER_URL) {
  console.log("Agent: CENTER_URL not set, agent mode disabled");
  return;
}
```

Rationale:
- No config file needed
- Can be set/unset via env editor
- Feature gated by presence of env var

### D5: TLS mutual authentication (optional)

**Decision:** Support mTLS via `CENTER_CA_CERT`, `CENTER_CLIENT_CERT`,
`CENTER_CLIENT_KEY` env vars. If set, agent presents client certificate
during WebSocket handshake.

Rationale:
- Zero-trust security model
- Optional — deployments without mTLS can rely on token auth
- Cert paths point to mounted files, not inline values

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Center Server not implemented yet | Agent module is designed and documented; can be built independently when Center Server exists |
| WebSocket reconnection storm | Exponential backoff with jitter + max cap |
| Command execution during upgrade | Queue commands during upgrade, execute after completion |
| Certificate rotation | Agent reads cert files at connect time, not at startup — supports hot-reload |

### D6: Action command types

**Decision:** Support three action command types. Payloads name the compose services
`ai-dev` / `ai-admin`; the agent resolves them to production containers via the
D9 convention (dev-safe in development runs).

| Command | Handler | Description |
|---------|---------|-------------|
| `upgrade` | `runUpgrade()` | Pull latest image, recreate ai-dev |
| `reconfigure` | env write + restart | Update `.env`, restart the ai-dev container |
| `restart` | `docker restart` | Restart the container named in the payload (`ai-dev` or `ai-admin`) |

Rationale:
- Reuses existing functions from `upgrade.ts` and `env.ts`
- Self-restart (`ai-admin`) sends its `ack` before restarting — response-first
  pattern — so the outcome is not lost when the connection drops (see
  `src/admin/routes/admin.ts`)
- The `agent-command` spec is the authoritative command semantics

### D7: Command deferral and offline queues

**Decision:** Command deferral has two tiers; a disconnected agent can never
"receive while disconnected", so the agent-side queue only holds commands that
were received but could not execute yet.

1. **Agent-side deferral queue** — a command received while an upgrade is in
   progress (or otherwise not immediately executable) is held in an in-memory
   FIFO queue and executed once the blocking condition clears. Queued commands
   survive a brief disconnection and execute after reconnect; the queue is lost
   on process restart.
2. **Center-side queue** — the Center Server may queue commands for an agent
   with no live connection and flush them only after the agent's `hello_ack`
   (see `center-protocol` spec).

```typescript
interface QueuedCommand {
  id: string;
  type: "upgrade" | "reconfigure" | "restart";
  payload: unknown;
  receivedAt: string;
}
```

Rationale:
- Ensures commands aren't lost during an in-progress upgrade or a brief disconnection
- In-memory queue (not persistent) — acceptable for admin dashboard use case
- Queue drained in FIFO order once the blocking condition clears

### D8: Status report payload

**Decision:** Heartbeat payload includes:

```typescript
interface StatusReport {
  container_status: "running" | "stopped";
  uptime_seconds: number | null;
  versions: Record<string, string>;
  gh_auth: "authenticated" | "not authenticated";
  glab_auth: "authenticated" | "not authenticated";
  admin_version: string;
  admin_version_mismatch: boolean;
  upgrade_state: string;
}
```

Rationale:
- Reuses fields from existing `/api/status` endpoint
- `admin_version_mismatch` enables Center Server to trigger restart

### D9: Container naming convention

**Decision:** The agent module operates in the production environment only. Compose service names `ai-dev` and `ai-admin` correspond to the production containers `ai-engkit` and `ai-engkit-admin`:

| Compose service | Production container |
|-----------------|----------------------|
| `ai-dev` | `ai-engkit` |
| `ai-admin` | `ai-engkit-admin` |

The test/dev containers (`ai-engkit-dev`, `ai-engkit-admin-dev`) are used only while developing or testing the module itself. The agent resolves the target container from its own container name via the existing `getSiblingDevContainerName()` convention in `src/admin/lib/docker.ts`, so a development run in the test environment targets the dev containers and can never touch production.

Rationale:
- `ai-admin` and `ai-engkit-admin` are easily confused; pinning the mapping avoids targeting the wrong container
- Sibling resolution is free safety: a dev-phase run automatically targets `ai-engkit-dev`/`ai-engkit-admin-dev` instead of production

### D10: Agent registration flow

**Decision:** Registration is token-based and happens at connection time, in two steps:

1. **Authenticated handshake** — the agent connects to the Center URL carrying its registration token. The token is embedded in `CENTER_URL` (e.g., `wss://center.example.com/ws?token=<token>`) or, when not embedded, taken from `CENTER_TOKEN`. The Center Server validates the token during the WebSocket upgrade; a valid token establishes the registered, authenticated channel.
2. **Hello handshake** — immediately after connect, the agent sends `hello` with `agent_id` (from `AGENT_ID`, falling back to the container hostname) and `protocol_version` (`1`). The Center Server replies `hello_ack`; only then does heartbeat/command traffic begin.

Rationale:
- A single URL input with an embedded token matches the operator workflow — one value to enter to register an agent
- The hello handshake decouples authentication (token, at handshake) from identification (`agent_id`, in-band)
- `AGENT_ID` keeps fleet identity stable across container recreations; the hostname fallback is for development
