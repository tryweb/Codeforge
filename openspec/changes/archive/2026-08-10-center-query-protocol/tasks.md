> **Prerequisite.** Implement and archive `agent-connection-module` before
> applying this change. This change modifies its shared `center-protocol` and
> `agent-command` contracts.

## 1. Protocol Extension (center-protocol)

- [x] 1.1 Extend the shared envelope type catalog with `result` and `event` (`src/admin/agent/`), keeping the catalog as the single source of truth
- [x] 1.2 Confirm hello `protocol_version` stays 1; `result`/`event` are valid catalog types for all agents
- [x] 1.3 Implement `result` envelope serialization (echoes query `id`; no `ack` sent for queries)
- [x] 1.4 Implement `event` envelope serialization (fire-and-forget, ordered, no ack)

## 2. Query Commands (agent-command)

- [x] 2.1 Route action commands to `ack` handlers and query commands (`status`, `env.get`, `projects.list`, `providers.list`) to `result` handlers; unknown command type → `error` `unknown_command`
- [x] 2.2 Implement `status` query handler reusing `/api/status` field assembly
- [x] 2.3 Implement `env.get` query handler reusing `readEnvFile()` with secret redaction/masking
- [x] 2.4 Implement `projects.list` query handler reusing shared project overview reads (`listProjects()`, `checkFeature()`, disabled state, and git remote)
- [x] 2.5 Implement `providers.list` query handler reusing `collectProvidersMeta()` with `maskKey()` masking

## 3. Verification

- [x] 3.1 Unit tests: query commands return `result` with matching `id`, no `ack`, no side effects
- [x] 3.2 Unit tests: `providers.list`/`env.get` payloads contain no raw key material
- [x] 3.3 Unit tests: agent rejects unknown command with `unknown_command` without side effects
- [x] 3.4 Integration test against a stub center: hello v1 → query → result round-trip; event stream ordering

## 4. Shared read paths and security boundaries

- [x] 4.1 Add failing tests for shared read-only access to provider metadata, project overview data, and status fields; then extract or export the route-local read helpers without changing local API behavior
- [x] 4.2 Add failing tests for env result redaction; then implement redaction for password-typed schema keys and masking/omission for key material while preserving non-secret values
- [x] 4.3 Add failing tests for event subscriber lifecycle; then wire one upgrade subscriber per active connection, remove it on disconnect and terminal upgrade event, and prevent duplicate subscriptions after reconnect
- [x] 4.4 Add failing tests for each query result schema and correlation; then enforce the pinned status, env, project, and provider result fields plus matching envelope ids and no raw key material
