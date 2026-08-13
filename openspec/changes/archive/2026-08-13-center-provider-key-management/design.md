# Design: center-provider-key-management

## Context

The agent (ai-admin) already exposes read-only queries to the center
(`providers.list` etc.) and three actions (`upgrade`, `reconfigure`,
`restart`) over the v1 WebSocket protocol. Provider keys live in
`provider-keys.json` (registry, plaintext, mode 0600) and are applied to the
ai-dev container's opencode auth store via `execInAiDev` + jq, followed by a
full container recreation (`compose up -d --force-recreate`) — the same flow
the local admin API (`src/admin/routes/providers.ts`) uses. That restart is
immediate and interrupts every in-flight OpenChamber session. This change
adds remote key mutation and makes the accompanying restart wait for idle
sessions by default.

Relevant existing pieces, all reused (no new persistence):
- Registry mutation: `addProviderKey` / `deleteProviderKey` /
  `setActiveProviderKey` / `updateProviderKeyNote` / `maskKey` —
  `src/admin/lib/provider-keys.ts`
- Auth-store apply: `applyActiveKey` / `removeAuthKey` /
  `clearProviderCache` / `isKeyProviderSupported` (whitelist: `opencode-go`) —
  `src/admin/lib/opencode-auth.ts`
- Command dispatch, two-ack pattern, deferral queue — `src/admin/agent/commands.ts`
- Container ops: `restartAiDev()` (compose recreate) and `execInAiDev`

## Goals / Non-Goals

**Goals:**
- Center can add, rotate (set-active), delete, and annotate (update-note)
  provider keys remotely, restricted to key-managed providers
- Key changes that affect the live credential apply to the auth store and
  restart ai-dev — gracefully by default (wait for all sessions idle), force
  on explicit request or timeout
- Reuse the registry library, auth-store apply pipeline, and container ops the
  local admin already uses — identical behavior, no parallel code paths
- Keep the protocol additive within version 1; never echo plaintext keys

**Non-Goals:**
- Provider entry configuration (`providers.configure`, OPENCODE_PROVIDER env)
  — deferred; key + memo only
- Center-side RBAC / per-command authorization — center's concern, outside the
  wire protocol (see D4 of center-query-protocol)
- Restarting only the opencode server instead of the whole container —
  investigated; chamber's respawn behavior for killed `opencode serve`
  processes is unverified, so the safe default mirrors local behavior (full
  container recreation after the idle wait). A narrower restart is a possible
  follow-up.
- Streamed wait-progress events — the two-ack pattern carries the outcome;
  progress streaming can layer on the existing `event` channel later

## Decisions

### D1: Four new action commands, additive within protocol version 1

`providers.key.add`, `providers.key.set-active`, `providers.key.delete`,
`providers.key.update-note` join `CommandType`. They are actions (mutate
state), so they follow the existing action contract: `ack` outcomes with the
two-ack pattern (accepted/starting, then final), participation in the upgrade
deferral queue, `error` `malformed_command` / `unknown_command` on bad payloads.

Payload shapes:

| Command | Payload | Restart? |
|---|---|---|
| `providers.key.add` | `{provider, value, note?}` | First key only (mirror local) |
| `providers.key.set-active` | `{provider, keyId, mode?}` | Yes (per mode) |
| `providers.key.delete` | `{provider, keyId, mode?}` | Only if active key removed |
| `providers.key.update-note` | `{provider, keyId, note}` | No |

`mode` ∈ `"graceful" \| "force"`, default `"graceful"`.

Rationale: matches the `verb.noun` query naming; actions reuse the established
ack/deferral machinery instead of introducing a parallel response path.

### D2: Provider whitelist — `isKeyProviderSupported()` only

Commands accept a `provider` string and are validated against the existing
whitelist (`KEY_MANAGED_PROVIDERS = ["opencode-go"]`). Non-whitelisted
providers are rejected with `error` `malformed_command` before any mutation.
Support for a new provider is a one-line change to the whitelist.

Rationale: only key-managed providers have an auth-store apply path
(`applyActiveKey`); env-based providers (`options.apiKey`) are the deferred
`providers.configure` scope.

### D3: Registry semantics mirror the local admin API exactly

The handlers call the same library functions in the same order as
`src/admin/routes/providers.ts`:

- **add**: first key for a key-managed provider with no auth-store key → apply
  + restart (mode honored); apply failure rolls the key back and reports
  failure. First key while the auth store already holds a key → reject
  (409-equivalent) to avoid silently replacing an unknown credential.
- **set-active**: persist selection → apply → restart per mode. Apply failure
  reverts the selection (same rollback the local route performs).
- **delete**: delete from registry; if the removed key was active — promote
  next (apply + restart) or `removeAuthKey` + cache clear + restart when the
  last key goes. Non-active deletion is registry-only, no restart.
- **update-note**: registry-only, no apply, no restart.

Rationale: one behavior for local and remote surfaces; tests can share
fixtures and expectations.

### D4: Restart modes — graceful (default) vs force

The restart step after an apply accepts a mode:

- **force** — the current behavior: `compose up -d --force-recreate` (or
  `docker restart` fallback), interrupting any in-flight sessions.
- **graceful** —
  1. Poll OpenChamber's control API from inside ai-dev:
     `POST /api/openchamber/control` with
     `{action: "session.list", input: {all: false, limit: 500, withStatus: true}}`
     via `execInAiDev("curl ...")`.
  2. Wait until every listed session reports `status.type == "idle"`.
     `busy`, `retry`, `unknown`, and API failure keep the poller waiting
     (unknown and API failure are transient — the opencode server may be
     mid-recovery).
  3. Deadline: 10 minutes, 15 s poll interval. On deadline → fall back to
     force and report it in the final `ack` (`message` states the mode used,
     e.g. `"restart: graceful (waited for 2 sessions)"` vs
     `"restart: force (timeout after 600s, 1 session still busy)"`).
  4. On idle: stop the container cleanly (`docker stop` — SIGTERM lets the
     opencode server checkpoint its SQLite WAL) then `compose up -d` to
     recreate.

Rationale: the ai-dev `opencode.db` (~9.8 GB + active WAL) is written
constantly; a SIGKILL-level recreate mid-write risks SQLite corruption. The
idle wait plus SIGTERM stop makes the 9.8 GB store the primary beneficiary,
not just session UX. OpenChamber's control API is the authoritative live
session source — the `session` table in `opencode.db` has no status column,
and chamber's own wait logic treats `busy`/`retry` as active, everything else
as idle.

### D5: Key material is contained in the command payload only

The plaintext key appears only in the `providers.key.add` / `set-active`
(no — `set-active` carries `keyId`, not the value) command payload and only
travels center→agent. `ack` payloads carry masked keys (`maskKey`) or key
ids, never the raw value. Logs and error messages never include the key
value. The existing `result` masking contract is unchanged.

Rationale: the protocol's security posture so far is "no plaintext leaves the
agent"; this is the single deliberate exception, scoped to the mutating
command payload and covered by the same TLS (wss) channel the token already
uses.

### D6: Chamber control API auth is a verified-at-implementation detail

The chamber daemon runs with `hasUiPassword: true`; the control endpoint may
require the UI password. The admin already holds `OPENCHAMBER_UI_PASSWORD` in
its env and can pass it (`-H "x-openchamber-password: ..."` or the header the
chamber build expects). The exact header is confirmed during implementation
with a spike against the running container; the poller abstracts the
credential as a `CommandDeps` injection so tests use a stub.

### D7: New `CommandDeps` surface

The dispatcher gains injected capabilities (matching the existing pattern —
`createRealCommandDeps` wires them):

```ts
interface CommandDeps {
  // ...existing...
  addProviderKey: (provider: string, value: string, note: string) => ProviderKey;
  setActiveProviderKey: (provider: string, keyId: string) => boolean;
  deleteProviderKey: (provider: string, keyId: string) => boolean;
  updateProviderKeyNote: (provider: string, keyId: string, note: string) => boolean;
  isKeyProviderSupported: (provider: string) => boolean;
  applyActiveKey: (provider: string, key: string) => Promise<void>;
  removeAuthKey: (provider: string) => Promise<void>;
  clearProviderCache: () => Promise<void>;
  readProviderAuthKey: (provider: string) => Promise<string | null>;
  readActiveKey: (provider: string) => string | null;   // registry lookup
  waitForIdleSessions: (opts: { timeoutMs: number; intervalMs: number }) => Promise<"idle" | "timeout" | "unavailable">;
  restartAiDev: ...existing...
}
```

`waitForIdleSessions` is the only new runtime mechanism; everything else is a
thin binding over existing library functions. Tests inject fakes for all of
it, so the graceful-wait logic is unit-testable without docker or chamber.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Plaintext key in a command payload captured in logs/transit | TLS channel already in place; masking contract covers all responses; no key in logs or error messages (spec + tests) |
| Graceful wait hangs on a stuck session | 10 min deadline → force fallback, reported in final ack |
| Control API auth changes between chamber versions | Credential/header isolated in one helper + spike during implementation; `waitForIdleSessions` degrades to `unavailable` → force on API failure |
| Set-active applied but restart fails | Registry selection rolled back on apply failure (mirror local); ack reports failure with the error |
| Chamber respawns a killed `opencode serve` and half-recreates state | Not relied on — graceful path recreates the whole container; server-only restart explicitly out of scope |
| Local and remote behavior drift | Both surfaces call the same library functions; tests cover the shared registry/apply fixtures |

## Migration Plan

1. Lands after `center-query-protocol` (already archived) — additive within
   protocol version 1, no version negotiation.
2. Rollback: remove the four command types from the catalog; the center
   simply cannot mutate keys, `providers.list` read path is untouched.
3. Center-side: `docs/specs/agent-center-protocol.md` updated so the center
   implementation can send the new commands; center UI work is a separate
   deliverable.
