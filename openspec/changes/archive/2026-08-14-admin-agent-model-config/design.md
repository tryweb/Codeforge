## Context

See proposal.md for motivation. Current state that shapes the approach:

- OMO plugin 4.19.4 assigns agent models from built-in `AGENT_MODEL_REQUIREMENTS` fallback chains resolved against connected providers (verified in `dist/index.js`). The only user-config override the plugin consumes is `agents.<name>.fallback_models` in `~/.omo/omo.jsonc` (`getRawFallbackModelsForSession`; also `categories.<name>.fallback_models`, and `plan` inherits `prometheus` when the planner is enabled).
- `~/.omo/omo.jsonc` lives in the `omo-config` volume, mounted **only** in ai-dev (verified in both compose files). The admin container mounts `.env`, compose file, `admin-data`, backups, and docker.sock — not `~/.omo`.
- The managed opencode server (`opencode serve` spawned by OpenChamber) requires Basic auth: `Authorization: Basic base64("opencode:<OPENCODE_SERVER_PASSWORD>")`. The password is stable only when `.env` sets `OPENCODE_SERVER_PASSWORD`; otherwise OpenChamber rotates a random password per spawn. Its port is published in `~/.config/openchamber/managed-opencode/*.json` and can change after restart.
- Restarting the managed opencode server makes it re-read config from disk (OpenChamber `lifecycle.js`), so a config change takes effect after an ai-dev restart. Admin already has `execInAiDev()` (27 callers) and `restartAiDev()` (6 callers) as established levers.

## Goals / Non-Goals

**Goals:**
- Admin UI to view each OMO agent's plugin-default model and configure its default + fallback models.
- Writes land only in `agents.<name>.fallback_models`, preserving all other config and the `$schema` pin.
- Save performs apply → restart → confirmation (write landed, server came back), with rollback only on write/restart failure — the config-acceptance contract, since `/agent` never reflects `fallback_models`.
- An e2e test (`test/test-agent-model-e2e.sh`) that sets, confirms, and restores without leaving the environment dirty.

**Non-Goals:**
- Configuring `categories.<name>.fallback_models` (delegation categories) — same mechanism, separate scope; noted as follow-up.
- Changing OMO's built-in fallback chains or provider credential management (existing Providers page owns that).
- Making config changes hot-applicable without a restart (plugin reads config at server startup; restart is inherent).

## Decisions

**D1 — Write path: `execInAiDev` + jq, not a new volume mount.**
Admin writes `~/.omo/omo.jsonc` by `docker exec` into ai-dev, applying a targeted jq update for the single agent key, written via temp-file + atomic `mv`. Rationale: zero compose changes, works on already-deployed installs, matches the established `execInAiDev` pattern. Alternative (mount `omo-config` into admin) rejected: requires compose + volume recreation on every deployed host, and duplicates ownership semantics; alternative (admin writes a file on its own volume and a bootstrap copies it) rejected: creates a second source of truth that fights the entrypoint merge.

**D2 — Override key: `agents.<name>.fallback_models` only.**
Rejected alternatives, all verified inert or overridden in plugin 4.19.4: `[opencode].agents.<name>.model` (harness layer, overridden), opencode.json native `agent.<name>.model` (stripped by OpenChamber rewrite), agent frontmatter `model:` (overridden by plugin requirements). `fallback_models` is the documented, code-verified override; the UI additionally displays the *resolved* model so the user sees the effective result of inheritance (e.g. `plan` inheriting `prometheus`).

**D3 — Verification is config acceptance, not a `/agent` model comparison.**
Empirically verified on the dev environment: writing `agents.<name>.fallback_models` and restarting leaves `/agent`'s reported model unchanged — the endpoint reports the plugin's DEFAULT (AGENT_MODEL_REQUIREMENTS resolution), which never reflects `fallback_models` (those are consumed per-session at runtime by `getRawFallbackModelsForSession`). A live model comparison would therefore falsely roll back every legitimate change. Verification instead confirms: (1) the jq write landed (target key present, all other keys preserved), (2) the restart succeeded, (3) the managed server answers `/agent` again — it re-reads config from disk on restart. The `/agent` read remains for the informational "current (plugin default)" display only. Alternative (session-level model probe) was investigated: the session API does not expose the resolved model cheaply, and creating a session fires plugin hooks — not worth it for a save confirmation.

**D4 — Prerequisite: `OPENCODE_SERVER_PASSWORD` in `.env`.**
Verification and resolved-model display require a stable known password; without it OpenChamber rotates per spawn. The admin already mounts `.env`, so the value is readable. When absent: UI shows a warning, list omits resolved models, and write refuses apply with an explanatory error. This is the deliberate degradation path from spec "Password absent degrades gracefully".

**D5 — Rollback: snapshot before write, restore on write/restart failure only.**
Before applying, copy the current `~/.omo/omo.jsonc` content into `admin-data` (admin's own volume). Restore the snapshot via `execInAiDev` only when the write itself failed or the restart failed — in both cases disk would otherwise diverge from the running server. A model that does not resolve at runtime is expected behavior (the plugin's default may differ, and a model may be for a provider connected later), never a rollback trigger. Rationale: never leaves the environment half-applied; restoration is idempotent.

**D6 — Restart: reuse `restartAiDev()`.**
Compose force-recreate of ai-dev is the established, reliable lever (env and Providers pages already use it). It restarts OpenChamber, which respawns the managed opencode server, which re-reads `~/.omo/omo.jsonc` from disk. The UI must confirm the restart cost (active sessions interrupted), matching the env page's pattern.

**D7 — Model choices come from the connected-provider catalog; the API stays unrestricted.**
The UI's model selector lists models from the connected-provider catalog (falling back to the provider-model cache and finally to models observed live on `/agent` when the lazy plugin caches are absent), preventing the documented trap where a configured model on an unconnected provider never resolves. The write endpoint does not filter: programmatic writes may reference any model (e.g. pre-configuring a model for a provider to be connected later).

## Risks / Trade-offs

- [ai-dev restart interrupts active sessions on every apply] → UI confirm dialog + explicit "Restarting…" state; the e2e test runs on its own environment.
- [Port changes after restart; stale port → false negative] → always re-read `managed-opencode/*.json` after restart, pick the live PID, poll readiness before confirming.
- [jq write races with the entrypoint's boot-time merge] → writes happen only after boot (admin is a long-running sibling); entrypoint merge runs once at container start, so a post-boot write is never re-merged.
- [Password mismatch or wrong username convention on some installs] → confirmation surfaces as unverified (no false rollback); the UI prerequisite warning tells the user to set the var.
- [Users expect `/agent`'s model to change after configuring fallback_models] → it does not (verified): the UI labels the read-only column "current (plugin default)" and shows the configured chain separately, so the difference is visible rather than surprising.
- [Plugin upgrade changes fallback_models semantics] → the feature writes only the documented, schema-accepted key; a future plugin that surfaces configured models in `/agent` would make the informational column accurate without admin changes.

## Migration Plan

Deploy via the normal image build + compose recreate (ai-admin picks up the new route/view; ai-dev unchanged). Rollback: remove the routes/views and redeploy; any admin-written `fallback_models` remain as valid user config that OMO 4.19.4 keeps honoring — no config cleanup needed. The feature is additive; existing `plan`/`prometheus` fallback_models in `.opencode/omo.jsonc.default` are untouched.

## Open Questions

None — all unknowns that could change the specs/approach (auth mechanism, restart semantics, write path, scope) were resolved during research and are fixed by the decisions above.
