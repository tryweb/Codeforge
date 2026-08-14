# Design: center-agent-remote-management

## Context

See proposal.md — Why. The agent's local admin surface (`src/admin/`) already
implements every management capability this change exposes remotely: SSH keys
(`routes/ssh-keys.ts`), git config (`routes/git-config.ts`), GitHub auth
(`routes/gh-auth.ts`), GitLab auth (`routes/glab-auth.ts`), secrets
(`routes/secrets.ts`), and projects (`routes/projects.ts` + `project-sync.ts`).
The center protocol (`src/admin/agent/protocol.ts` + `commands.ts`) currently
routes only `upgrade`/`reconfigure`/`restart`/`providers.key.*` actions and
four queries. This change adds the remote command surface and wires each new
command to the exact logic the local routes already run.

The agent-side dispatch architecture is established: `parseCommandType()` in
`protocol.ts` whitelists command names; `createCommandDispatcher()` in
`commands.ts` routes to handlers bound through `CommandDeps`; handlers report
outcomes via `buildAck()` / `buildResult()` / `buildError()`. Provider-key
handlers already demonstrate the reuse pattern this change generalizes.

## Goals / Non-Goals

**Goals**
- Every item on the center-manager requirement list (passwords, SSH keys, git
  identity, GitHub/GitLab auth, projects lifecycle) becomes a center-driven
  command with behavior identical to the local admin UI.
- No behavior change to the local admin routes, except the SSH key name
  validation fix (see D9): unsafe key names are now rejected by the shared
  library, closing a latent path-traversal in the local route.
- Additive within protocol version 1 — existing commands, acks, and queries
  are untouched.
- Secret material (PATs, passwords, device codes) is never echoed outside the
  command payload / the single ack `data` that must deliver a device code.

**Non-Goals**
- The AI-EngKit-Manager (center) implementation. This change defines and
  implements the agent side; the Manager repo tracks its own change for the
  command senders and UI pages (see Migration Plan).
- Any new restart semantics. None of the new commands restart a container
  itself; `secrets.set` reports activation status and the center composes
  with the existing `restart` command.
- New persistence or data models. All mutations reuse existing stores
  (`.env`, `~/.ssh/`, git global config, `glab-cli/config.yml`,
  OpenChamber `settings.json` + disabled list, `provider-keys.json` untouched).

## Decisions

### D1: One command per local admin action, flat `domain.verb` naming

Seventeen new commands, named after the local routes they mirror
(`ssh.key.add`, `git.config.set`, `gh.auth.start`, `glab.instance.add`,
`projects.set-remote`, `secrets.set`, ...), extending the existing
`providers.key.*` flat convention.

- *Alternative rejected: a generic `admin.run` / action-passthrough command
  carrying an opaque action name + args.* Rejected because it defeats
  per-command payload validation, makes `unknown_command`/`malformed_command`
  semantics useless, and gives the center no typed contract to render forms
  against. Typed commands keep the protocol self-documenting and match the
  provider-key precedent.

### D2: Extract each route's logic into `src/admin/lib/<domain>.ts`; routes and handlers share it

Each domain route moves its logic into a shared library module; the route
becomes a thin HTTP wrapper and the agent handler binds the same functions
through `CommandDeps`:

| Command(s) | Shared module (new) | Logic moved from |
|---|---|---|
| `secrets.set` | `lib/secrets.ts` — `SECRETS_SCHEMA`, `setSecret()`, `getSecretActivationStatus()` | `routes/secrets.ts` |
| `ssh.key.add` / `ssh.key.delete` / `ssh.key.list` | `lib/ssh-keys.ts` — `listKeys()`, `addKey()`, `deleteKey()`, `getPublicKey()` | `routes/ssh-keys.ts` |
| `git.config.set` / `git.config.get` | `lib/git-config.ts` — `readGlobalConfig()` (masked), `setGlobalConfig()` | `routes/git-config.ts` |
| `gh.auth.start` / `gh.auth.logout` | `lib/gh-auth.ts` — `getGhStatus()`, `startDeviceFlow()`, `logout()` | `routes/gh-auth.ts` |
| `glab.instance.add` / `glab.instance.remove` / `glab.instances` | `lib/glab-auth.ts` — `normalizeHostname()`, `login()`, `logout()`, `listInstances()`, `setupCredentialHelper()` | `routes/glab-auth.ts` |
| `projects.*` (6 commands) | `lib/projects.ts` — `createProject()`, `setRemote()`, `enable()`, `disable()`, `enableFeature()`, `sync()` | `routes/projects.ts`, `routes/project-sync.ts` |

All shared functions take the existing `ProjectCommand`/`SettingsCommand`
(`execInAiDev`-shaped) adapter so tests inject fakes exactly as the route
tests do today.

- *Alternative rejected: agent handlers re-run the shell commands inline,
  duplicating route logic.* Rejected — the spec requires handler reuse, and
  duplication would let local and remote behavior drift (the provider-key
  change already established the shared-function rule).

### D3: Optional `data` field on the ack payload for `gh.auth.start`

`buildAck()` gains an optional `data` argument; the ack payload schema becomes
`{ status, message, started_at, finished_at, data? }`. Only `gh.auth.start`
populates it, with `{ device_code, verification_uri }` (same shape the local
`POST /api/auth/gh/start` returns, so the Manager UI can mirror the agent's
own page). Receivers must accept acks with or without `data`.

- *Alternatives rejected:*
  - `gh.auth.start` as a **query** answered with `result` — rejected:
    launching the device flow has a side effect, violating the
    "queries have no side effects" contract.
  - Device code streamed as an **`event`** — rejected: events are
    fire-and-forget and not correlated to the command id; a late/duplicate
    event is plausible and the center has no ack to key off.
  - New `gh.auth.device` **query** for the center to poll — rejected: adds
    pending-flow state and a race; the code exists synchronously at start.

### D4: Authentication completion observed through the existing `status` query

`gh.auth.start` returns immediately (the flow runs in the background, exactly
as the local page's `startAuth()` does). The center polls `status` and reads
`gh_auth` until it flips to `authenticated`. No new query, no new state.

### D5: `glab.instances` as a query; `status.glab_auth` stays a summary

The heartbeat's `glab_auth` is a single boolean summary. Per-instance
`{ hostname, username, authenticated }` needs its own read path, so a
dedicated query reuses `parseGlabInstances()` — which by construction only
reads token *presence*, never the token value, so the result needs no masking
pass. The `status` payload is untouched (backward compatible).

### D6: `secrets.set` never restarts; ack reports activation status

Mirrors the local Secrets page: `ADMIN_PASSWORD` is `immediate`,
`OPENCHAMBER_UI_PASSWORD` / `OPENCODE_SERVER_PASSWORD` are
`restart_required`. The ack carries the activation status so the center can
compose `restart` when needed. This avoids restarting `ai-admin` (which the
`reconfigure` command would not do either — it restarts `ai-dev`) and keeps
each command single-purpose.

### D7: Masking rules for new query results

- `git.config.get` drops `credential.*` and `url.*` entries (they encode
  helpers and possible embedded tokens), then masks any remaining value that
  matches the existing `KEY_MATERIAL_PATTERN` (`sk-`, `ghp_`, `glpat-`,
  `AIza`, `token=`, `secret`) — the same pattern `commands.ts` already uses.
- `glab.instances` omits tokens by construction (see D5).
- `ssh.key.list` returns `{ name, type, fingerprint }` by construction
  (see `listKeys()`); no key content is included.
- Device codes are masked in logs; the only outbound occurrence is the
  `gh.auth.start` ack `data`.

### D8: `projects.*` command payloads mirror the local route bodies exactly

`projects.create` accepts `{ name, git_init?, git_remote? }`, with
`git_init` defaulting to true when `git_remote` is supplied (the center
sending a remote expects a clone, not an empty directory); the shared
`createProject()` reproduces the route's clone-or-init branch, `.gitignore`
write, disabled-state clearing, and OpenChamber registration. `projects.sync`
accepts `{ add[], remove[] }` arrays validated with `isValidProjectName()`.
All shell commands flow through the `SettingsCommand` adapter with the same
timeouts (clone/fetch up to 120s; the two-ack pattern already makes long
commands safe — the accepted/starting ack precedes the final outcome).

### D9: SSH key name validation lives in the shared library (security fix)

The name validation for `ssh.key.add`/`ssh.key.delete` (no path separators or
shell-active characters) is enforced in `lib/ssh-keys.ts`, which the local
route also delegates to. This is a deliberate, small behavior change to the
local route: it currently relies on shell escaping and would write a key
outside `~/.ssh` for a name like `../../tmp/x` (a latent path-traversal).
Closing it at the shared boundary fixes the local route too; the local UI
shows the same validation rejection for unsafe names.

## Risks / Trade-offs

- **[Large command surface]** Sixteen commands is a lot of surface → grouped
  into six domain libraries, each independently testable; existing route
  tests guard the extracted behavior, new handler tests cover the commands.
- **[Route extraction could regress the local UI]** → extraction is
  behavior-preserving (routes delegate to the same functions); the existing
  route test suites (`projects.test.ts`, `project-sync.test.ts`, `agent.test.ts`,
  `commands.test.ts`, `integration.test.ts`) run unchanged and must stay green.
- **[Secret material handling]** PATs, passwords, and device codes are the
  highest-value leak target → command-payload-only containment + masking rules
  are spec'd as requirements with explicit scenarios; redaction tests follow
  the existing `env-redact` / key-material test patterns.
- **[Center sends new commands to an old agent]** → old agents answer
  `unknown_command`; the docs update states the new commands require matching
  agent and center versions (additive, but version-gated in practice).
- **[Device-flow UX depends on the operator]** → the ack `data` carries code
  + URI for the Manager to display; status polling closes the loop; no agent
  state is left dangling if the operator never completes the flow (gh CLI
  times out the code on its own).

## Migration Plan

- **Deploy:** agent change ships first (new handlers answer the new commands);
  then the Manager change (documented in its repo) adds the senders/UI. During
  the window, centers without the change simply never send the new commands.
- **Rollback:** revert the agent change; the new commands become
  `unknown_command` again and the local admin UI is unaffected (it runs on the
  same libs, which are unchanged in behavior).
- **Docs:** `docs/specs/agent-center-protocol.md` is updated with the full
  wire contract (command names, payloads, ack/result shapes) as the reference
  for the Manager-side implementation. The Manager repo tracks its own
  openspec change (command senders in `src/ws/agent-center.ts` + UI pages).

## Open Questions

- Manager-side UI layout and page composition (one page per domain vs a
  combined "Agent Config" page) — deferred to the Manager repo change; the
  wire contract here does not constrain it.
- Whether `gh.auth.start` should additionally surface the authenticated user
  info (login/avatar) after completion — the existing `status` query's
  `gh_auth` field is sufficient for the connect/disconnect requirement; user
  detail can be added to a future query without protocol changes.
