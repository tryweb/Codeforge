# Design: Update OMO default config to pinned schema

## Context

See proposal.md — Why. The shipped `.opencode/omo.jsonc.default` is written against the oh-my-openagent 4.19.3 schema (`permission` on agents, `fallback_models` chains), but the runtime pins and loads 4.19.4, whose `OmoAgentDefInputSchema` is `.strict()` and rejects `permission`, and which deprecates `fallback_models` in favor of `model`/`models`. Empirically verified on the dev environment: with `permission` present, `oh-my-opencode config migrate --dry-run` reports `Unrecognized key: "permission"` for every agent, the `agents` block fails validation, and all per-agent model overrides (both `model` and `fallback_models`) are silently ignored. Removing `permission` makes the config validate clean.

## Goals / Non-Goals

**Goals:**
- Make the shipped default template schema-valid for the pinned OMO release so fresh installs boot with honored agent model config.
- Correct the `admin-agent-model-config` spec claims that were based on the invalid-config behavior (e.g. "the plugin does not consume `model`").

**Non-Goals:**
- No runtime migration of existing installs' omo.jsonc (volume-persisted config is left untouched, per the user's decision — the default template only affects first boot).
- Not changing the admin UI behavior in this change (the UI write path will be revisited after the config-validity fix; the delta spec updates the contract, implementation follows).
- Not resolving the remaining "subagent primary model override" uncertainty (whether `agents.<name>.model` fully controls subagent spawn) — that is a separate investigation.

## Decisions

**D1 — Rewrite `.opencode/omo.jsonc.default` in place, keeping the 11-agent preset structure.**
Remove every `permission` key (4.19.4 does not accept it, and it was never honored — the runtime fell back to defaults) and convert `fallback_models` chains to `models` arrays (single entries become `model`). Rationale: minimal diff, preserves the documented 11-agent shape, and the entrypoint merge logic (`jq -s '.[0] * .[1]'`) is key-based and unaffected by the value format change. Alternative (migrate at entrypoint) rejected: it would touch every boot and duplicate the plugin's own migration.

**D2 — Keep the runtime merge mechanism unchanged.**
`initialize_omo_permissions` already implements the desired semantics: create from default when missing, shallow-merge when `agents` absent, leave untouched when `agents` present. Only the template content changes. Alternative (force re-merge on every boot) rejected: it would destroy user edits.

**D3 — Spec corrections are contract-only; implementation of the corrected admin write path is deferred.**
The `admin-agent-model-config` delta spec updates the requirements (schema-valid keys, invalid-config surfacing). The actual admin code change (writing `models` instead of deprecated `fallback_models`, and reporting config validity) is a follow-up implementation task in the same change's tasks.md, sized separately.

## Risks / Trade-offs

- [Existing installs keep an invalid omo.jsonc until manually fixed] → The admin "Agent Models" page surfaces invalid config (delta spec scenario), and the corrected write path will produce schema-valid entries from then on. A one-time manual cleanup (remove `permission` keys) is documented in tasks.
- [The 4.19.4 agent schema may not be the final word (permission semantics moved elsewhere)] → The template targets the pinned release; `check-versions.sh` and the dependency-update workflow already track version bumps and will re-validate the template against the new schema.
- [fallback_models → models conversion may change which chain the plugin honors] → Verified: `models` is the documented replacement (doctor: "Replace fallback_models with models"); the plugin's `normalizeLegacyModelFields` also auto-converts, so behavior is preserved.

## Migration Plan

1. Rewrite `.opencode/omo.jsonc.default` (remove permission, convert fallback_models → models).
2. Rebuild the image; `/etc/opencode/omo.jsonc.default` reflects the new template.
3. Existing installs: no action (volume config untouched). Fresh installs get the valid template on first boot.
4. Rollback: revert the template commit and rebuild; no runtime state was mutated.

## Open Questions

None — the remaining subagent-model uncertainty is explicitly out of scope (see Non-Goals) and does not affect this change's specs or tasks.
