# Proposal: center-agent-remote-management

## Why

The center can today read agent state (`status`, `env.get`, `projects.list`,
`providers.list`) and run a small set of actions (`upgrade`, `reconfigure`,
`restart`, `providers.key.*`) — but every day-to-day management task an
operator needs still requires SSH-ing into the agent's local admin UI. SSH
keys, git identity, GitHub/GitLab authentication, project lifecycle, and the
service passwords are all reachable only through the agent's own dashboard
(`src/admin/`). Centralized fleet management cannot onboard, configure, or
recover an agent without a remote channel for the rest of the local admin
surface.

This change extends the `center-protocol`/`agent-command` command catalog with
remote management commands that mirror the agent's existing local admin routes
— same semantics, same underlying libraries, same validation — so the center
manager can configure an agent end-to-end without touching its local UI.

## What Changes

Fourteen new action commands and three new query commands join the catalog.
All action handlers reuse the exact library functions the local admin routes
use; none reimplement route logic.

- **`secrets.set`** — write one of the schema-validated password secrets
  (`ADMIN_PASSWORD`, `OPENCHAMBER_UI_PASSWORD`, `OPENCODE_SERVER_PASSWORD`).
  The ack reports the activation status (`immediate` vs `restart_required`),
  mirroring the local Secrets page. The operator pairs it with `restart` when
  a restart is required.
- **`ssh.key.add`** / **`ssh.key.delete`** / **`ssh.key.list`** — generate
  (ed25519/rsa), remove, or list SSH keys in the ai-dev home, mirroring the
  local SSH Keys page.
- **`git.config.set`** / **`git.config.get`** — set a global git config key
  (e.g. `user.name`, `user.email`) or read the global config. The get result
  drops `credential.*`/`url.*` entries and masks key-like values, so the
  response never leaks credential helpers or embedded tokens.
- **`gh.auth.start`** / **`gh.auth.logout`** — start the GitHub device-code
  flow on the agent and report the device code back to the center (the ack
  payload gains an optional `data` field), or disconnect GitHub. Completion
  is observed by polling the existing `status` query (`gh_auth`).
- **`glab.instance.add`** / **`glab.instance.remove`** / **`glab.instances`**
  — register a GitLab instance (hostname + personal access token), remove one,
  or list configured instances with user/status. The PAT travels in the
  command payload only and is never echoed.
- **`projects.create`** — clone a remote or `git init` a new project
  (mirrors the local New Project flow, including `.gitignore`, disabled-state
  clearing, and OpenChamber registration). Supplying a `git_remote` defaults
  `git_init` to true so the project is cloned rather than created empty.
- **`projects.set-remote`** — set/replace/remove the `origin` remote, with
  the existing fetch/checkout bootstrap for fresh repos.
- **`projects.enable`** / **`projects.disable`** — enable (unmark + register
  with OpenChamber) or disable (mark + unregister) a project.
- **`projects.enable-feature`** — enable the `knowledge`, `maintenance`, or
  `openspec` skill scaffold on a project.
- **`projects.sync`** — reconcile workspace directories with OpenChamber
  registration (`add`/`remove` arrays), mirroring the local Sync page.

Protocol-level additions, all additive within protocol version `1`:

- The `ack` payload MAY carry an optional `data` object for commands whose
  outcome includes machine-readable material (currently only `gh.auth.start`).
- Key-material containment extends to GitLab PATs and device codes: plaintext
  travels in the command payload only; responses/logs mask or omit it.

## Dependencies

Depends on `center-query-protocol` and `center-provider-key-management`
(archived): the `command` envelope, two-ack outcome pattern, `result`/`event`
types, masking contract, and `reconfigure` env write are all reused. The delta
specs modify the same `center-protocol` and `agent-command` requirements.

**Center-side (AI-EngKit-Manager) is a separate change.** This change defines
and implements the agent-side contract. The Manager repo needs a parallel
change (its own `agent-center.ts` command set + UI pages) to actually send
these commands; the design documents the wire contract it implements against,
and the docs/specs/agent-center-protocol.md reference is updated here.

## Capabilities

### New Capabilities

- *(none — this change extends existing capabilities, no new capability paths)*

### Modified Capabilities

- `center-protocol`: extend the message catalog with the new action/query
  command types, add the optional ack `data` field, and extend key-material
  containment to GitLab PATs and device-flow codes.
- `agent-command`: route the new command types to handlers that reuse the
  local admin route logic (secrets, ssh-keys, git-config, gh-auth, glab-auth,
  projects), with per-domain payload validation and result masking rules.

## Impact

- **`src/admin/agent/`**: `protocol.ts` command-name sets; `commands.ts`
  `CommandDeps` extensions + new action/query handlers (secrets, ssh, git,
  gh/glab auth, projects) reusing the local libs; new unit/integration tests.
- **`src/admin/routes/`**: the local route logic (secrets, ssh-keys,
  git-config, gh-auth, glab-auth, projects) is extracted/exported behind
  shared functions where the agent handlers bind through `CommandDeps` — the
  same pattern `center-provider-key-management` established; route behavior
  is unchanged.
- **`src/admin/lib/`**: reuse `env.ts`, `docker.ts` (`execInAiDev`),
  `openchamber-projects.ts`, `projects-overview.ts` — no new persistence code.
- **`docs/specs/agent-center-protocol.md`**: document the new commands for
  the center-side implementation (Manager repo tracks its own UI change).
- **Dependencies**: none new — Bun stdlib, `execInAiDev`, existing compose
  commands, `gh`/`glab`/`git`/`ssh-keygen` inside ai-dev.
- **Protocol compatibility**: additive within version `1`; existing command
  types, ack semantics, and queries are untouched (ack `data` is an optional
  additive field).
