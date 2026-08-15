## Context

See `proposal.md` for motivation. Runtime experiments established three independent states: removing only the stale `[opencode].agents.librarian` value still selected Qwen, removing only invalid `permission` entries exposed the stale DeepSeek value, and removing both made top-level `agents.librarian.model` resolve to Nemotron. The fix therefore must address schema validity and precedence together.

The persisted OMO volume must remain user-writable and durable. Initialization must be idempotent, preserve unrelated user configuration, and avoid weakening non-convertible permission policies.

## Goals / Non-Goals

**Goals:**

- Establish top-level `agents.<name>.model` as the only Admin-managed primary model source.
- Normalize known stale settings without replacing the entire user configuration.
- Preserve known read-only tool restrictions using the pinned schema's `tools` map.
- Verify both model advertisement and actual child-session execution.

**Non-Goals:**

- Changing OMO's built-in fallback chain.
- Selecting primary models for users who have not configured one.
- Migrating arbitrary permission expressions whose semantics cannot be represented as tool booleans.
- Changing native OpenCode primary-agent model routing.

## Decisions

### Normalize the two conflicting layers atomically

Startup normalization will operate on a temporary file, validate the result, and atomically replace `~/.omo/omo.jsonc`. In one transformation it will remove `[opencode].agents`, migrate supported permission entries, and retain top-level agent models. Applying only one half leaves a demonstrated fallback or stale-override path.

Alternative considered: fix only the librarian entry. Rejected because other Admin-managed subagents can encounter the same stale layer and invalid schema state.

### Preserve restrictions through `tools`, not unsupported `permission`

Known direct tool allow/deny entries will become boolean `tools` entries. Redundant allow-all entries will be omitted. Unknown patterns, wildcard scopes, or non-boolean-equivalent policies will not be deleted; normalization will retain them and surface an error for manual resolution.

Alternative considered: delete every permission object. Rejected because that can silently broaden agent capabilities.

### Use one canonical primary model field

Admin writes and startup preservation will target only `agents.<name>.model` with a complete catalog-backed `provider/model` value. `[opencode].agents` will not be retained as a compatibility layer because its precedence is ambiguous and it can override current Admin state.

Alternative considered: synchronize both locations. Rejected because duplicated sources can diverge and retain the defect.

### Separate persistence, advertisement, and execution verification

Verification will proceed in order: schema-valid persisted config, successful restart and reachability, live `/agent` agreement, then a real librarian child session whose completed assistant message identifies the model actually used. The E2E request will omit an explicit model so it tests agent resolution rather than request-level forcing.

Alternative considered: trust `/agent` alone. Rejected because it does not prove the model attached to an executed child assistant message.

## Risks / Trade-offs

- [A permission policy cannot be represented by `tools`] → Preserve it, report the exact path, and require manual migration rather than weakening it.
- [Normalization modifies a persistent user file] → Snapshot first, use atomic replacement, preserve unrelated content, and test byte-identical idempotence and rollback.
- [Nemotron is temporarily unavailable] → The execution test fails with the actual provider/model rather than accepting fallback as success.
- [Managed server startup is asynchronous] → Bound polling by health and reachability rather than fixed sleep intervals.
- [Test sessions or temporary settings survive failure] → Install trap-based cleanup before the first mutation.

## Migration Plan

1. Update shipped defaults and migration fixtures to use schema-valid tool restrictions and no `[opencode].agents` layer.
2. Add idempotent startup normalization with snapshot and atomic write behavior.
3. Update Admin reporting to distinguish persisted, live, and effective model states.
4. Run unit/config migration tests, then the managed `/agent` check and real librarian child-session E2E.
5. On failure, restore the saved OMO configuration, restart the service, and retain diagnostics for the incompatible path or observed runtime model.
