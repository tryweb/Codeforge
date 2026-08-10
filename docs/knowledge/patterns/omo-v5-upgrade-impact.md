# OMO v5.x Upgrade Impact (assessed at 5.0.0-beta.3)

## Context

ai-engkit consumes oh-my-openagent (OMO) exclusively as an **OpenCode npm plugin** — never as a CLI:

- `opencode.json` → `plugin: ["oh-my-openagent@${OH_MY_OPENAGENT_VERSION}"]`, Dockerfile `ARG OH_MY_OPENAGENT_VERSION=4.19.4`.
- Config: `.opencode/omo.jsonc.default` (11 agents) baked to `/etc/opencode/omo.jsonc.default`, merged into `~/.omo/omo.jsonc` at startup by `entrypoint.d/02-init-config.sh`.
- Version pipeline: `.opencode/scripts/check-versions.sh` + `.github/workflows/dependency-update.yml` compare against the npm `latest` dist-tag and sync the `$schema` tag in `omo.jsonc.default` (also in `check-updates` SKILL).

OMO v5.0.0 (beta line `5.0.0-beta.1` → `5.0.0-beta.3`, published 2026-08-09/10) is a major rewrite: native CLI `omo-agent-toolkit`, Senpi edition (`omo-ai`, `omo` command), unified config `~/.omo/omo.jsonc` with harness blocks, one-way legacy-config migration, `omo` bin removed, `shared/<name>` skill names → bare names, reasoning/model config standardization.

## Problem

Does upgrading to omo v5 break AI-EngKit's plugin-based consumption? Which moving parts (install path, config format, schema, CLI, CI) are affected, and are there silent failure modes?

## Solution

Verified upgrade facts (2026-08-10, npm + v5.0.0-beta.3 source):

1. **npm reality**: `oh-my-openagent` dist-tags `latest=4.19.4`, `beta=5.0.0-beta.3` (beta tag advanced past beta.2). Published versions are immutable — a pin of `5.0.0-beta.2` still resolves.
2. **Plugin load path unchanged**: root package is `oh-my-opencode` with `main: ./dist/index.js`; `exports` map identical between v4.19.4 and v5. `plugin: ["oh-my-openagent@<v>"]` loads v5 exactly like v4.
3. **Config surface already v5-native**: AI-EngKit writes `~/.omo/omo.jsonc` with top-level `agents` — the v5 unified path and a still-valid v5 key. Per-agent keys in `assets/omo.schema.json` are identical between v4.19.4 and v5.0.0-beta.3 (16 keys, `additionalProperties: false`). Note: `permission`/`fallback_models` are absent from the *assets* schema in **both** versions — they live in the runtime dist schema and are genuinely consumed (`omo-fallback-model-config.md`).
4. **`omo` bin removed** (new: `omo-agent-toolkit`) — irrelevant here; the repo never invokes the CLI.
5. **OpenCode requirement ≥1.4.0**; AI-EngKit pins 1.18.15.
6. **Skill names** `shared/<name>` → bare names; repo already uses bare names.
7. **One-way legacy migration** on first v5 run (`~/.omo/migration-backup-*`, `_migrations` markers). AI-EngKit's entrypoint already archives legacy `oh-my-openagent.json*` / `oh-my-opencode.json*` to `.ai-engkit-legacy-backup`, deliberately preempting OMO's cross-volume migration.
8. **New memory subsystem is Senpi-only**: `memory-core`, `omo-memory-mcp.js`, `OMO_MEMORY_HOME`, `~/.omo/memory`, `memory.enabled` are wired into `packages/omo-senpi` **only**. `packages/omo-opencode` (AI-EngKit's harness) does not import/register/read any of it. The `memory` block in the unified schema is harness-neutral; only the Senpi adapter acts on it. → No interaction with lean-ctx (paths disjoint: `~/.omo/memory` vs lean-ctx XDG dirs; volumes `omo-config` vs `lean-ctx-data`/`lean-ctx-state`).
9. **beta.2 = source-state republish** of beta.1 (no notes). **beta.3 = Senpi memory fixes only** (6 commits; `packages/memory-core` + `packages/omo-senpi`); no `omo-opencode`, schema, or bin changes.

## Why It Works

- Plugin identity and entry (`main`/`exports`) are unchanged, so opencode loads v5 identically to v4.
- Config path + `agents` key align with v5's native format, so no legacy migration of the repo's own config is triggered.
- Harness isolation keeps memory dormant in AI-EngKit's runtime — no double memory layer with lean-ctx.

## Side Effects / Tradeoffs

- **CI blind spots (fix before adopting)**:
  - `check-versions.sh` `get_npm_latest` reads the npm `latest` dist-tag → betas are **never** flagged as outdated; upgrading to v5 requires a manual Dockerfile ARG bump.
  - `dependency-update.yml` + `check-updates` schema-sync `sed` pattern `v[0-9.]*/assets/...` succeeds on the first bump (`v4.19.4` → `v5.0.0-beta.3`) but **silently no-ops on subsequent beta bumps** (hyphen breaks the `[0-9.]` char class). Widen to e.g. `v[0-9][0-9A-Za-z.-]*`.
- **Downgrade is one-way**: v5 rewrites config into its unified format; v4 may reject v5-only keys. Volumes (`omo-config`) already back up `~/.omo`.
- **Open items needing a smoke test** (beta): whether v5's opencode plugin still registers all 11 agents, enforces `permission`, and discovers skills; whether `~/.cache/oh-my-opencode` legacy cache dir is still used by v5.
- **`fallback_models` migration opportunity**: v5's canonical chain key is `models` (present in both v4/v5 schemas). Move `plan`/`prometheus` fallbacks when bumping.

## Evidence

- npm registry 2026-08-10: dist-tags `latest=4.19.4`, `beta=5.0.0-beta.3`; `5.0.0-beta.2` and `5.0.0-beta.3` published.
- package.json v4.19.4 vs v5.0.0-beta.3: identical `name`/`main`/`exports`; bins v4 `{lazycodex, lazycodex-ai, oh-my-openagent, oh-my-opencode, omo}` → v5 drops `omo`, adds `omo-agent-toolkit`.
- `assets/omo.schema.json` v4.19.4 (857 825 B) vs v5.0.0-beta.3 (1 003 623 B): per-agent keys identical, `additionalProperties: false`; both have top-level `agents, models, profiles, codegraph, memory`.
- beta.2→beta.3 diff: functional changes only under `packages/memory-core/` + `packages/omo-senpi/`; `packages/omo-opencode` untouched.
- `packages/omo-opencode/src/index.ts` + `create-plugin-module.ts` (beta.3): no memory imports; memory `memory.enabled` consumed only in `packages/omo-senpi/src/components/memory/wiring.ts`.

## Related Files

- `Dockerfile` (`ARG OH_MY_OPENAGENT_VERSION`)
- `.opencode/omo.jsonc.default`
- `entrypoint.d/02-init-config.sh`
- `.opencode/scripts/check-versions.sh`
- `.github/workflows/dependency-update.yml`
- `.opencode/skills/check-updates/SKILL.md`
- `docs/knowledge/patterns/omo-fallback-model-config.md`
- `docs/knowledge/patterns/omo-agent-permission-defaults.md`
- `docs/knowledge/patterns/version-management-pipeline.md`

## Tags

- oh-my-openagent
- omo-v5
- upgrade-impact
- dependency-pinning
- opencode-plugin
- lean-ctx
