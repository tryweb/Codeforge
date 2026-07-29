# Proposal: adopt-omo-jsonc-unified-config

## Why

oh-my-openagent's unified `omo.jsonc` configuration is the target configuration surface, but AI-EngKit still ships and maintains the legacy `~/.config/opencode/oh-my-openagent.json` file, and `~/.omo` is not persisted. Consequences if we do nothing: (a) user customizations to `omo.jsonc` vanish on every container recreate, (b) the entrypoint keeps merging defaults into a legacy file OMO no longer reads after migration, and (c) an unversioned runtime plugin declaration permits silent OMO upgrades.

Remote validation against OMO v4.19.3 found that its legacy migration archives the source with `rename()`. A legacy file in the existing `opencode-config` named volume cannot be renamed into a backup in a separate `omo-config` named volume (`EXDEV`). This change avoids that path by archiving recognized legacy sources inside `opencode-config` before OMO starts, then generating unified defaults directly.

## What Changes

- Ship AI-EngKit's OMO defaults (11 agent permission presets) in the new unified format: new `.opencode/omo.jsonc.default` replacing the role of `.opencode/oh-my-openagent.json.default`.
- `entrypoint.d/02-init-config.sh`: change the merge target from `~/.config/opencode/oh-my-openagent.json` to `~/.omo/omo.jsonc`; stop generating the legacy file; rely on OMO's built-in startup migration for users with existing legacy files.
- Pin the `$schema` URL in the shipped default to an OMO release tag (e.g. `v4.19.3`) instead of the floating `dev` branch.
- `docker-compose.yml` and `docker-compose.dev.yml`: add an `omo-config` named volume persisting `/home/devuser/.omo`.
- Pin `OH_MY_OPENAGENT_VERSION=4.19.3` and make the entrypoint emit that versioned plugin declaration at runtime.
- Update `docs/knowledge/patterns/omo-agent-permission-defaults.md` and related docs to describe the omo.jsonc flow.
- Existing legacy config is preserved under an AI-EngKit backup suffix but is not imported; unified config receives the supported 11 permission presets.

## Capabilities

### New Capabilities

- `omo-unified-config`: AI-EngKit ships OMO defaults in omo.jsonc format, generates/merges `~/.omo/omo.jsonc` at container start, pins the config schema to a release tag, and coexists correctly with OMO's legacy migration.
- `omo-config-persistence`: the user-level `~/.omo` directory survives container recreation via a named volume, so migrated config and user edits are not lost.

### Modified Capabilities

<!-- No existing specs in openspec/specs/ — nothing to modify. -->

## Impact

- **Code**: `Dockerfile` (ARG pin, baked templates), `entrypoint.d/02-init-config.sh` (merge target + legacy handling), `.opencode/omo.jsonc.default` (new), `.opencode/oh-my-openagent.json.default` (deprecated), `docker-compose.yml`, `docker-compose.dev.yml`.
- **Docs**: `docs/knowledge/patterns/omo-agent-permission-defaults.md`, possibly `docs/knowledge/tooling/codegraph-omo-integration.md`.
- **Tests**: integration tests must cover omo.jsonc generation, merge idempotency, volume persistence, and legacy migration coexistence.
- **Users**: existing `opencode-config` volumes containing `oh-my-openagent.json` are auto-migrated by OMO on first start (one-time backup under `~/.omo/`).
- **Dependencies**: requires oh-my-openagent v4.19.3 unified-config behavior; pairs with pinning and runtime normalization of `OH_MY_OPENAGENT_VERSION`.
