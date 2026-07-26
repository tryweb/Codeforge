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
interface AgentMessage {
  type: "heartbeat" | "command" | "ack" | "error";
  payload: unknown;
  id: string;
  timestamp: string;
}
```

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

### D6: Command types

**Decision:** Support three command types:

| Command | Handler | Description |
|---------|---------|-------------|
| `upgrade` | `runUpgrade()` | Pull latest image, recreate ai-dev |
| `reconfigure` | env write + restart | Update .env, restart affected container |
| `restart` | `docker restart` | Restart specified container |

Rationale:
- Reuses existing functions from `upgrade.ts` and `env.ts`
- restart uses response-first pattern to avoid connection drop (see `src/admin/routes/admin.ts`)

### D7: Offline command queue

**Decision:** Commands received while disconnected are buffered in memory and executed on reconnect.

```typescript
interface QueuedCommand {
  id: string;
  type: "upgrade" | "reconfigure" | "restart";
  payload: unknown;
  receivedAt: string;
}
```

Rationale:
- Ensures commands aren't lost during brief disconnections
- In-memory queue (not persistent) — acceptable for admin dashboard use case
- Queue drained in FIFO order after successful reconnect

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
