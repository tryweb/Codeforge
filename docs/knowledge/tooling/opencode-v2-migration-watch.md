# OpenCode V2 Migration Watch

## Context

- AI-EngKit pins OpenCode V1 (`Dockerfile: ARG OPENCODE_VERSION=1.18.27`, installed via `bun install -g opencode-ai@${OPENCODE_VERSION}`) with `oh-my-openagent@4.19.4` as the only `plugin[]` entry.
- OpenCode V2 is in beta (`@opencode-ai/cli@beta = 0.0.0-beta-18999` as of 2026-09-03), binary `opencode2`, side-by-side with V1 `opencode`.
- Decision (2026-09-03): stay on V1 for production; track V2 and migrate only after GA + `oh-my-openagent` ships a V2-compatible line.

## Problem

V2 has exactly three intentional breaking changes (`https://opencode.ai/v2/docs/migrate-v1/`):

1. Plugin API rewrite (`server(input)` → `Plugin.define({ id, setup(ctx) })`). V1 plugins do not load in V2.
2. Server API + client contract rewrite (still fluid during beta; `specs/v2/schema-changelog.md` records session/event/projection resets).
3. Terminal config `tui.json(c)` (layered) → single global `~/.config/opencode/cli.json` (auto-migrated on first V2 start; project-local client config is NOT migrated; service does not read it).

AI-EngKit's two real breakpoints:

- **External plugin**: no in-repo `server(input)` code exists; the break is upstream — `oh-my-openagent@4.19.4` must release a V2 port. `omo.jsonc.default` is OMO's own schema (`agents.*.tools.{read,bash,edit,write,webfetch}`, `models[]` with separate `variant`), not opencode native config, so editing it changes nothing until upstream moves.
- **Self-owned Server API clients**: all `curl`-in-shell, no `@opencode-ai/client`. Endpoints that break: `POST /session`, `POST /session/:id/prompt_async`, `POST /session/:id/message`, `GET /session/:id/message`, `GET /session/status`, `GET /session/:id/state`, `GET /agent`, `GET /provider`, `GET /api/session?directory&limit&cursor`, `DELETE /session/:id`.

## Solution

Watch stance + GA migration checklist:

1. Keep `OPENCODE_VERSION` pinned; evaluate V2 only in an isolated image (Docker/Homebrew packaging is unsupported during beta; `opencode2` cannot just replace the `Dockerfile` install line).
2. Wait for `oh-my-openagent` V2 line before touching `omo.jsonc.default` or `entrypoint.d/02-init-config.sh` plugin generation (`plugin: [...]` tuple → `plugins: [{package, options}]`).
3. Centralize the curl-based Server API calls behind one shim now (V1/V2-agnostic), so GA migration is a single rewrite to `@opencode-ai/client@beta` (`OpenCode.make({baseUrl})` → `session.create/prompt` → `event.subscribe()`; service via `Service.discover/ensure/stop`).
4. New skills/commands already use V2-preferred layout (`.opencode/skills/<id>/SKILL.md`, `.opencode/commands/*.md`); keep it. Merge any `CLAUDE.md` fallback content into `AGENTS.md` (V2 only discovers `AGENTS.md`).
5. At GA: ask OpenCode to convert config to native V2 format in place (`permission/tools` → ordered `permissions[]` with `bash→shell`, `task→subagent`, `write/patch→edit`; `agent/mode` → `agents` with `prompt→system`, `disable→disabled`, `model#variant`; `snapshot→snapshots`, `attachment→media`, `command→commands`, `mcp.*.enabled→disabled`, `provider.npm→package` with `aisdk:` prefix). Keep V1 setup until each area is verified.

## Why It Works

- Outside the three breaking areas, V2 normalizes supported V1 config/agents/commands/skills/`.opencode/` files in memory without rewriting source — no flag-day needed (`migrate-v1` guide).
- AI-EngKit's config is runtime-generated (`02-init-config.sh`), so migration is a generator change, not a static-file edit; skills/commands need no move (`skill(s)/`, `command(s)/` both discovered).
- V1/V2 data dirs are independent (shared db file, separate `session_v2` tables, no V1 history import, copy-on-write), so parallel trial cannot corrupt V1 state.

## Side Effects / Tradeoffs

- Beta API drift: pin exact `@opencode-ai/cli@<beta-N>` / `@opencode-ai/client@<beta-N>` when trialing; expect re-pins. No official single-package V1+V2 dual-target pattern exists (community: build-time guard or separate `2.x` line).
- Known beta gaps to re-check at GA: silent TUI-plugin load failure after `cli.json` migration (upstream #46408 refs); V1 session history not imported (#41217, partial fix `migration.v1-v2`); ecosystem reports V2 plugin context lacks compaction-context and restarted-child-session recovery hooks (goal-plugin notes).
- Plan-mode system-reminder gap is **unconfirmed** — no first-party V2 doc found; do not cite as fact.
- V2 disables tmux/zellij multiplexers by default (native subagent rendering); revisit any flow assuming multiplexer availability.

## Evidence

- Inventory method (2026-09-03): `codegraph_explore` + `ctx_glob **/opencode.json*` (0 hits in repo) + `ctx_read .opencode/omo.jsonc.default` (94 lines, V1-style tools/models) + `ctx_search Dockerfile` (`OPENCODE_VERSION=1.18.27`, `OH_MY_OPENAGENT_VERSION=4.19.4`, superpowers baked to `/opt/opencode/baked-plugins/superpowers`).
- Plugin/API surface: background explore found no `.opencode/plugin/*.ts`; 8+ curl endpoints enumerated in `src/admin/lib/model-probe.ts`, `agent-model-live.ts`, `agent-model-history.ts`, `agent/commands.ts`, `scripts/agent-model-health.sh`, `scripts/reconcile-agent-models.sh`, `test/test-agent-model-e2e.sh`.
- External: `https://opencode.ai/v2/docs/migrate-v1/` (breaking changes + field map), `https://opencode.ai/v2/docs/build/plugins/`, `/build/sdk`, `/build/client`, `/cli/config`; npm dist-tags `beta: 0.0.0-beta-18999` (cli/client/sdk), V1 `1.18.27` (2026-09-02 changelog).
- Validation: no code changed in this task; two of four background explore agents returned analysis-only (empty results), compensated with direct reads above.

## Related Files

- `Dockerfile` (OPENCODE_VERSION, OH_MY_OPENAGENT_VERSION, baked superpowers)
- `entrypoint.d/02-init-config.sh` (runtime opencode.json generation)
- `.opencode/omo.jsonc.default` (OMO agent/model/tool schema)
- `src/admin/lib/model-probe.ts`, `src/admin/lib/agent-model-live.ts`, `src/admin/lib/agent-model-history.ts`
- `src/admin/agent/commands.ts` (OPENCODE_SESSION_PROBE_SCRIPT, pgrep fallback)
- `scripts/agent-model-health.sh`, `scripts/reconcile-agent-models.sh`, `test/test-agent-model-e2e.sh`
- `.opencode/skills/*/SKILL.md`, `.opencode/commands/opsx-*.md`, `.opencode/AGENTS.md.default`

## Tags

- opencode-v2
- migration-watch
- plugin-api
- server-api
- oh-my-openagent
- version-pinning
