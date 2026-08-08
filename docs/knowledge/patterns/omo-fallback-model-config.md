# OMO Fallback Model Config (v4.19.4 config-driven)

## Context

ai-engkit uses oh-my-openagent (OMO) 4.19.4. The plugin assigns default models to its 11+ registered agents via built-in fallback chains. To steer `plan` and `prometheus` toward the desired models and provide fallbacks on provider saturation, the config file needs a `fallback_models` key per agent.

## Problem

- The previous 4.19.3-era model-default migration (`apply_omo_model_defaults`) was verified inert — see `troubleshooting/omo-model-default-migration-inert.md`.
- Unknown whether `agents.<name>.fallback_models` in `.opencode/omo.jsonc.default` / `~/.omo/omo.jsonc` is actually consumed by plugin 4.19.4, and whether it survives restart (the plugin runs a strict migration validation at startup that flags unknown config keys).

## Solution

Set `fallback_models` under `agents.plan` and `agents.prometheus` in both `.opencode/omo.jsonc.default` and `~/.omo/omo.jsonc`:

```jsonc
"plan": {
  "fallback_models": [
    { "model": "opencode-go/kimi-k3", "variant": "max" },
    { "model": "openai/gpt-5.6-sol", "variant": "high" },
    { "model": "openai/gpt-5.6-luna" }
  ]
}
```

Bump the live `$schema` pin to v4.19.4 to match the installed plugin.

## Why It Works

- `getRawFallbackModelsForSession` (dist/index.js ~119502) reads `pluginConfig.agents.plan.fallback_models` directly — the key is genuinely consumed.
- Runtime schema `AgentOverrideConfigSchema` (dist/index.js ~26808) defines both `fallback_models` and `permission` fields for each known agent.
- Migration validation accepts `fallback_models` (neither `plan` nor `prometheus.fallback_models` appear in the startup validation error), while `permission` is flagged — see Side Effects.
- Restart confirmed: post-restart log shows `config-handler agents loaded` (13 agents) and `config handler applied {agentCount:13}`.

## Side Effects / Tradeoffs

- **Startup migration validation error (pre-existing noise)**: the migration schema `OmoAgentDefInputSchema` has no `permission` field, so 11 agents' `permission` blocks produce `Unrecognized key: "permission"` in `[config-migration] startup completed`. This predates the fallback_models change (admin's original permission-only config triggered it), does not block runtime config loading, and is harmless — but appears at every startup.
- Restart required for config changes to take effect.
- All fallback models must exist on connected providers or fallback resolution returns empty (log: `connected providers unknown, returning empty set for fallback resolution`).

## Evidence

- Plugin log `/tmp/oh-my-opencode.log` (2026-08-08 restart):
  - `config-handler agents loaded` + `config handler applied {agentCount:13}` — config loads.
  - `[config-migration] startup completed {"error":"Migration validation failed ... Unrecognized key: \"permission\" ..."}` — 11 agents flagged for `permission` only; `plan` and `fallback_models` not flagged.
- Provider cache `/home/devuser/.cache/oh-my-opencode/provider-models.json` (17:19 refresh): `opencode-go` has `kimi-k3`; `openai` has `gpt-5.6-sol`, `gpt-5.6-luna`. `connected-providers.json`: opencode-go, openai, opencode, nvidia connected.
- Schema validation: SCHEMA-OK against `oh-my-opencode.schema.json` v4.19.4 for both config files.
- Code references: `getRawFallbackModelsForSession` (dist/index.js ~119502), `AgentOverrideConfigSchema` (dist/index.js ~26808), `OmoConfigSchema` (dist/index.js ~5705).

## Related Files

- `.opencode/omo.jsonc.default`
- `~/.omo/omo.jsonc`
- `docs/knowledge/troubleshooting/omo-model-default-migration-inert.md`
- `docs/knowledge/patterns/omo-agent-permission-defaults.md`

## Tags

- oh-my-openagent
- fallback-models
- model-config
- config-driven
