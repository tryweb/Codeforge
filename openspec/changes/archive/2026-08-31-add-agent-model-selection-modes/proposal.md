## Why

Admin Agent Models currently requires selecting an explicit `provider/model` even though Provider catalogs contain pricing, capability, context, and lifecycle metadata that can produce useful recommendations. Adding a mode selector to Generate Suggestions makes the existing workflow easier to use while preserving manual control and the existing apply-and-verify safety path.

## What Changes

- Add a Provider-scoped selection mode to Generate Suggestions, with the Admin UI defaulting to `free`.
- Keep requests that omit `mode` backward-compatible with the existing capability-only suggestion behavior.
- Retrieve supplemental model metadata from the fixed OpenCode/models.dev catalog source and intersect it with models currently available from connected OpenCode Providers.
- Define deterministic `free`, `economy`, and `performance` filtering and ranking rules, including explicit handling for unknown, stale, deprecated, and unavailable metadata.
- Return a documented suggestion response containing mode, Provider scope, model metadata, ranking reasons, source status, and warnings.
- Keep generated results as recommendations until accepted; accepted models continue through the existing validation, Apply, restart, probe, verification, and rollback flow.
- Ensure free mode never silently falls back to a paid or metadata-unknown model.

## Capabilities

### New Capabilities

- `admin-agent-model-selection-modes`: Provider-scoped, metadata-assisted model suggestion modes for Admin Agent Models.

### Modified Capabilities

None. Existing reconciliation, configuration, and apply requirements remain unchanged; the new behavior is additive to the suggestion flow.

## Impact

- Admin Agent Models API, reconciler, live catalog client, model metadata normalization, and Agent Models UI.
- New tests for request compatibility, response schema, metadata enrichment, cache freshness, mode filtering/ranking, empty-candidate behavior, and UI request state.
- External read dependency on the fixed OpenCode/models.dev catalog; connected OpenCode `/provider` remains authoritative for runtime availability.
- No new persisted fallback-chain behavior, no automatic runtime switching, and no change to existing persisted explicit model values.
