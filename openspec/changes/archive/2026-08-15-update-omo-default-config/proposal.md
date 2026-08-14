## Why

The shipped `.opencode/omo.jsonc.default` uses the oh-my-openagent 4.19.3 config schema (`permission` keys on agents, `fallback_models` for model chains), but the Dockerfile pins and the runtime loads oh-my-openagent **4.19.4**, whose agent schema removed `permission` and deprecated `fallback_models` in favor of `model`/`models`. The result is that every fresh install (and the current dev environment) boots with an **invalid** omo.jsonc: the whole `agents` block fails strict schema validation, so all per-agent model overrides are silently ignored and the admin "Agent Models" page's fallback-chain writes never take effect.

## What Changes

- **Rewrite `.opencode/omo.jsonc.default` to the 4.19.4 schema**: remove the `permission` key from every agent entry (it is unrecognized by `OmoAgentDefInputSchema` and was never honored at runtime anyway), and convert `fallback_models` chains to the `models` key (or `model` for single entries).
- **Update `OH_MY_OPENAGENT_VERSION` pin references**: the spec still documents 4.19.3 while the Dockerfile pins 4.19.4 — align the spec's documented pin with reality.
- **Fix `admin-agent-model-config` spec inaccuracies**: the current spec claims "the plugin does not consume a user-specified primary `model` field on `agents.<name>` — verified empirically". That claim is wrong for the 4.19.4 delegate-task path (`resolveSubagentModel` / `resolveModelAndFallbackChain` honor `agentOverride?.model` as the highest priority). The spec must reflect that `agents.<name>.model` IS honored when the config validates.
- **No runtime migration**: existing installs keep their omo.jsonc in the named volume untouched (per the user decision) — the fix is the shipped default template and the startup path that creates omo.jsonc from it on first boot.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `omo-unified-config`: the shipped `omo.jsonc.default` template's agent schema (permission removal, fallback_models → models) and the documented OMO version pin (4.19.3 → 4.19.4) change.
- `admin-agent-model-config`: the model-resolution architecture note changes — `agents.<name>.model` IS honored by the 4.19.4 plugin when the config is schema-valid, so the "Resolved model cannot be overridden" claim and the fallback-chain-only write behavior need revision.

## Impact

- **Code**: `.opencode/omo.jsonc.default` (template rewrite); `entrypoint.d/02-init-config.sh` may need a small adjustment if the merge logic depends on the old structure (the merge is shallow and key-based, so likely unchanged).
- **Runtime state**: fresh installs get a schema-valid omo.jsonc from first boot; existing installs unchanged (volume-persisted omo.jsonc is not rewritten).
- **Docs/specs**: `omo-unified-config` and `admin-agent-model-config` delta specs.
- **Tests**: existing `run-tests.sh` assertion that `/etc/opencode/omo.jsonc.default` parses and contains 11 agent presets must still hold; schema validation (via `oh-my-opencode config migrate --dry-run`) should pass clean.
