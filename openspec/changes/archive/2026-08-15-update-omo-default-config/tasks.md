# Tasks: Update OMO default config to pinned schema

## 1. Template rewrite

- [x] 1.1 Rewrite `.opencode/omo.jsonc.default`: remove the `permission` key from every agent entry (4.19.4 `OmoAgentDefInputSchema` is strict and rejects it); keep the 11-agent preset structure (explore, oracle, librarian, multimodal-looker, metis, momus, prometheus, sisyphus, hephaestus, atlas, sisyphus-junior, plan)
- [x] 1.2 Convert `fallback_models` chains to schema-valid keys in the template: multi-entry chains become `models` arrays; single entries become `model`; verify against `OmoAgentDefInputSchema` (accepted keys: description, prompt, model, models, reasoning, variant, reasoningEffort, tools, execution_mode, background, max_depth, allowed_subagents, disallowed_tools, max_turns, temperature, disable)
- [x] 1.3 Verify the template parses and validates: run `oh-my-opencode config migrate --dry-run --json` against a copy — expect `"error": null` / empty diagnostics with zero "Unrecognized key" messages

## 2. Version pin alignment

- [x] 2.1 Confirm `OH_MY_OPENAGENT_VERSION=4.19.4` in the Dockerfile matches the template's `$schema` tag (`v4.19.4`) and the runtime plugin — update either if mismatched
- [x] 2.2 Check `check-versions.sh` and the dependency-update workflow still pass with the pinned version and template schema tag

## 3. Entrypoint verification

- [x] 3.1 Confirm `entrypoint.d/02-init-config.sh` `initialize_omo_permissions` needs no change: the shallow merge (`jq -s '.[0] * .[1]'`) is key-based and unaffected by the value format change; first-boot copy path unchanged
- [x] 3.2 Verify `test/run-tests.sh` assertion "omo.jsonc.default in /etc/opencode" still holds after the template rewrite and image rebuild

## 4. Spec-adjacent implementation (admin write path contract)

- [x] 4.1 Update `src/admin/lib/agent-models.ts` write path to emit schema-valid keys: write `model` (single) / `models` (chain) instead of the deprecated `fallback_models`, preserving `$schema` pin and other agents byte-identical (unit tests updated accordingly)
- [x] 4.2 Update `readAgentModelsConfig` and the list route to surface invalid agent config (e.g. entries failing the pinned schema) instead of silently ignoring them, per the delta spec scenario
- [x] 4.3 Run admin unit tests from `src/admin` cwd (full suite must stay green) and re-run `test/test-agent-model-e2e.sh` set→confirm→restore cycle

## 5. Manual verification on dev environment

- [x] 5.1 Rebuild the dev image, force-recreate ai-dev, and confirm `oh-my-opencode doctor` no longer reports "Invalid configuration" for the default-loaded omo.jsonc
- [x] 5.2 Confirm existing dev omo.jsonc (volume-persisted) is untouched by the restart (user customizations preserved verbatim)
- [x] 5.3 Fresh-boot smoke: with an empty `~/.omo`, confirm omo.jsonc is created from the new template and passes validation
