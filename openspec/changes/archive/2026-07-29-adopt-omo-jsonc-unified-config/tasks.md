# Tasks: adopt-omo-jsonc-unified-config

## 1. Verify upstream behavior (resolve open questions)

- [ ] 1.1 Verify against oh-my-openagent v4.19.3 schema whether top-level `agents` in omo.jsonc is honored for the opencode harness (design Q1); if not, plan `[opencode]` namespace placement
- [x] 1.2 Verify recognized legacy filenames and archive semantics; confirm archiving in `opencode-config` prevents OMO migration, journal, and OMO backup creation

## 2. Ship omo.jsonc defaults

- [x] 2.1 Create `.opencode/omo.jsonc.default` containing the 11 agent permission presets (content ported from `.opencode/oh-my-openagent.json.default`, harness placement per 1.1)
- [x] 2.2 Pin the `$schema` URL in the new default to the v4.19.3 tag (no `/dev/` branch)
- [x] 2.3 Update the Dockerfile: set `OH_MY_OPENAGENT_VERSION=4.19.3`, expose it at runtime, and bake `omo.jsonc.default` to `/etc/opencode/omo.jsonc.default`
- [x] 2.4 Deprecate `.opencode/oh-my-openagent.json.default`: remove its COPY from the Dockerfile (keep or remove the file itself per repo hygiene decision; update references)

## 3. Entrypoint: generate and merge omo.jsonc

- [x] 3.1 In `entrypoint.d/02-init-config.sh`, normalize an unset or bare `oh-my-openagent` plugin token to `oh-my-openagent@${OH_MY_OPENAGENT_VERSION}` while preserving an explicitly versioned user token
- [x] 3.2 Replace the oh-my-openagent.json merge block with omo.jsonc logic: create `~/.omo/` (mkdir -p, devuser ownership), and if `~/.omo/omo.jsonc` is missing or lacks `.agents`, shallow-merge the baked default under existing content (user keys win)
- [x] 3.3 Archive recognized legacy OMO config filenames inside `~/.config/opencode` before OMO starts, without importing their content; ensure the entrypoint never generates a legacy file
- [x] 3.4 Confirm `00-fix-perms.sh` (or equivalent) covers `~/.omo` ownership for fresh volumes

## 4. Persistence

- [x] 4.1 Add `omo-config:/home/devuser/.omo` named volume to `ai-dev` in `docker-compose.yml` (declare in top-level `volumes:`)
- [x] 4.2 Add the same volume to `docker-compose.dev.yml`; confirm no other service (e.g. ai-admin) needs it (design Q3)

## 5. Integration tests

- [x] 5.1 Test: fresh start creates `~/.omo/omo.jsonc` with all 11 agent presets; `$schema` is tag-pinned
- [ ] 5.2 Test: two consecutive restarts leave omo.jsonc byte-identical (idempotency)
- [ ] 5.3 Test: user-edited omo.jsonc survives container recreate (volume persistence + merge policy)
- [x] 5.4 Test: seeded legacy OMO config is archived within `opencode-config`, unified defaults are generated, and distinct `omo-config` contains no OMO migration journal or OMO migration backup
- [x] 5.5 Test: `~/.omo` is devuser-owned and writable (migration lock acquisition works)

## 6. Docs and hygiene

- [x] 6.1 Update `docs/knowledge/patterns/omo-agent-permission-defaults.md` for the omo.jsonc flow (bake → entrypoint merge → `~/.omo/omo.jsonc`; legacy migration note; "edit omo.jsonc, not the legacy file")
- [x] 6.2 Review `docs/knowledge/tooling/codegraph-omo-integration.md` for stale references to the legacy config path
- [x] 6.3 Update README / .env.example if they mention `OH_MY_OPENAGENT_VERSION=latest` or the legacy config file
- [ ] 6.4 Run `openspec validate adopt-omo-jsonc-unified-config` and the full integration suite before commit
