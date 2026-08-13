# Proposal: center-provider-key-management

## Why

The center-query-protocol change opened a read-only window into agent state:
`providers.list` returns masked registry keys, but the center cannot *write* —
there is no way to add a new API key for `opencode-go` or to switch which key is
active. Key rotation, onboarding, and credential recovery all require the
operator to SSH into the admin UI of the affected agent. Centralized fleet
management cannot reach provider-config parity without a remote mutation
channel.

This change adds four provider-key action commands (`providers.key.add`,
`providers.key.set-active`, `providers.key.delete`, `providers.key.update-note`)
so the center can add, rotate, and annotate keys on a managed agent, and —
because switching a live key requires the ai-dev container to pick up the new
credential — defines *when* the accompanying restart happens: a **graceful**
restart that waits for all in-flight OpenChamber sessions to finish (default),
or a **forced** restart that interrupts them (current behavior, explicit opt-in).

## What Changes

- **Four new action commands** join the agent command catalog. All operate on
  the existing `provider-keys.json` registry through the same library functions
  the local admin API uses, and enforce the existing key-managed-provider
  whitelist (`opencode-go` initially).
- **`providers.key.add`** — append a key (+ optional note) to the registry.
  Matching local semantics, the first key for a key-managed provider is applied
  to the auth store and triggers a restart.
- **`providers.key.set-active`** — switch the active key, apply it to the
  ai-dev auth store (`~/.local/share/opencode/auth.json`), clear the provider
  cache, and restart the container according to the requested mode. Selection
  is rolled back if the apply fails.
- **`providers.key.delete`** — remove a key; deleting the active key promotes
  the next one (applied + restart), and removing the last key clears the auth
  store entry. Key removals of active keys follow the same restart mode.
- **`providers.key.update-note`** — change the memo only; no apply, no restart.
- **Restart modes for key changes.** `set-active` and `delete` accept
  `mode: "graceful" | "force"` (default `graceful`). Graceful waits until every
  non-archived OpenChamber session is idle — polled via OpenChamber's own
  control API (`POST /api/openchamber/control`, `session.list` with live
  status) from inside the ai-dev container — then stops the container cleanly
  (SIGTERM, SQLite WAL checkpoint) before recreation. On timeout (10 min) or
  control-API failure, the restart falls back to force; the final `ack`
  reports which path was taken. Force restarts immediately, as today.
- **Key-material containment.** The plaintext key travels center→agent inside
  the command payload only. Acks, results, and events never echo it; responses
  carry masked keys (`maskKey()`), and the existing `providers.list` masking
  contract is unchanged.

## Dependencies

Depends on `center-query-protocol` (archived): the `command` envelope,
two-ack outcome pattern, `result`/`event` types, and the masking contract are
all reused. The delta specs modify `center-protocol` and `agent-command`
requirements introduced by that change; `provider-api-key-registry` deltas
formalize remote access to the store the admin-provider-config change created.

## Capabilities

### New Capabilities

- *(none — this change extends existing capabilities, no new capability paths)*

### Modified Capabilities

- `center-protocol`: extend the message catalog with four provider-key action
  commands and add the command-payload-only key-material containment rule.
- `agent-command`: add provider-key mutation routing, the auth-store apply
  pipeline, and the graceful/force restart-mode semantics for key changes.
- `provider-api-key-registry`: remote commands mutate the same registry file
  through the same library functions as the local admin API, gated by the
  key-managed-provider whitelist.

## Impact

- **`src/admin/agent/`**: four new action handlers in `commands.ts` +
  `CommandDeps` extensions; a graceful-restart wait helper (chamber control
  API polling via `execInAiDev`); payload parsers and validation; new tests.
- **`src/admin/lib/`**: reuse `provider-keys.ts` (registry mutation),
  `opencode-auth.ts` (auth-store apply/remove + cache clear) — no new
  persistence code.
- **`docs/specs/agent-center-protocol.md`**: document the four new commands
  and the restart-mode semantics for the center-side implementation.
- **Dependencies**: none new — Bun stdlib, `execInAiDev`, the existing
  compose/docker commands. `curl` inside ai-dev calls the chamber control API.
- **Protocol compatibility**: additive within version `1`; existing command
  types and semantics are untouched.
