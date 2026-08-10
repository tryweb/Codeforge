## 1. WebSocket Client (Capability: agent-connect)

- [x] 1.1 Implement outbound WebSocket client with `CENTER_URL` env var
- [x] 1.2 Implement exponential backoff reconnect with jitter (1s → 300s max)
- [x] 1.3 Implement connection lifecycle logging (connect/disconnect/reconnect events)

## 2. Heartbeat Protocol (Capability: agent-heartbeat)

- [x] 2.1 Implement 60s interval heartbeat that sends status report
- [x] 2.2 Build status report payload from existing `getStatus()` functions (container state, versions, auth)
- [x] 2.3 Implement server-side ack handling

## 3. Command Dispatch (Capability: agent-command)

- [x] 3.1 Implement command message parsing and routing
- [x] 3.2 Implement "upgrade" command handler (calls existing `runUpgrade()`)
- [x] 3.3 Implement "reconfigure" command handler (calls env write + restart)
- [x] 3.4 Implement "restart" command handler (calls docker restart)
- [x] 3.5 Implement command deferral queue (hold commands blocked by an in-progress upgrade; retain across brief disconnects; execute in FIFO order once clear)

## 4. Security (Capability: agent-security)

- [x] 4.1 Implement TLS mutual authentication (CENTER_CA_CERT, CENTER_CLIENT_CERT, CENTER_CLIENT_KEY)
- [x] 4.2 Implement pre-shared token auth as fallback (CENTER_TOKEN)
- [x] 4.3 Implement command validation (reject unknown command types)

## 5. Integration

- [x] 5.1 Wire agent module into server startup (start after HTTP server)
- [x] 5.2 Add `CENTER_URL`, `AGENT_ID`, `CENTER_TOKEN` + cert vars to `.env.example` and env schema
- [x] 5.3 Add agent status to `/api/status` response

## 6. Protocol (Capability: center-protocol)

- [x] 6.1 Extract registration token from `CENTER_URL` (query param) or `CENTER_TOKEN` and present it during the WebSocket handshake
- [x] 6.2 Implement `hello`/`hello_ack` handshake (agent_id from `AGENT_ID`, fallback container hostname; `protocol_version` = 1)
- [x] 6.3 Correlate `ack`/`error` by envelope id, preserving the id through the agent-side deferral queue
- [x] 6.4 Implement command outcome acks (`status`/`message`/`started_at`/`finished_at`) and the reserved error codes
