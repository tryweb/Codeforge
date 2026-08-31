## Purpose

Provide explainable, Provider-scoped Agent model recommendations that use current catalog metadata to help administrators choose free, economical, or performance-oriented models without losing manual control.

## Requirements

### Requirement: Provider-scoped selection mode

The Admin Agent Models suggestion endpoint SHALL accept an optional `mode` with the values `free`, `economy`, or `performance`, and an optional `providers` list. The Admin UI SHALL default its mode selector to `free`. When `mode` is omitted by an API caller, the endpoint SHALL preserve the existing capability-only suggestion behavior and SHALL NOT apply a cost-mode filter. An explicit mode request SHALL consider only the selected connected Providers; an omitted or empty provider list SHALL consider all connected Providers.

#### Scenario: UI generates free suggestions by default
- **WHEN** an administrator opens Agent Models, selects a connected Provider, and activates Generate Suggestions without changing the mode
- **THEN** the UI sends `mode: "free"` and the endpoint returns only free-mode suggestions for that Provider

#### Scenario: Legacy API request remains compatible
- **WHEN** an API caller submits the existing suggestions request without a `mode` field
- **THEN** the endpoint uses the existing capability-only ranking behavior instead of implicitly applying the free filter

#### Scenario: Explicit mode limits Provider scope
- **WHEN** an administrator submits `providers: ["opencode-go"]` and `mode: "economy"`
- **THEN** every returned suggestion belongs to OpenCode Go and no model from another connected Provider is considered

### Requirement: Catalog metadata enrichment and source status

For an explicit mode request, the system SHALL retrieve metadata from the fixed server-side `https://models.dev/api.json` source using one bounded request for the complete catalog, then filter it to the selected Provider IDs. The system SHALL join metadata to the connected OpenCode catalog by complete Provider/model identity. The response SHALL expose `sourceStatus` as `fresh`, `stale`, or `unavailable`, `sourceAgeMs` when a snapshot exists, and a `warnings` array. The external catalog SHALL supplement but SHALL NOT override connected OpenCode availability.

#### Scenario: Connected model receives metadata
- **WHEN** a model exists in both the external metadata catalog and the connected OpenCode catalog
- **THEN** the suggestion includes normalized cost, context, capability, lifecycle, and freshness fields when those fields are available

#### Scenario: External-only model is excluded
- **WHEN** a model exists in the external catalog but not in the current connected OpenCode catalog
- **THEN** the model is excluded from all suggestions

#### Scenario: External source is unavailable
- **WHEN** the metadata request times out, fails, or returns malformed data and no valid cache exists
- **THEN** an explicit mode request returns HTTP 200 with empty mode-aware suggestions, `sourceStatus: "unavailable"`, and a `metadata_unavailable` warning, while manual model configuration remains available

### Requirement: Metadata freshness and stale-cache behavior

The metadata client SHALL use a three-second request timeout, SHALL treat cached metadata no older than one hour as fresh for `free` mode, and SHALL treat cached metadata no older than six hours as usable but stale for `economy` and `performance` modes. Free mode SHALL exclude all candidates when its metadata is stale or unavailable. Economy and performance MAY rank stale metadata, but their response SHALL include `sourceStatus: "stale"`, `sourceAgeMs`, and a `stale_metadata` warning. No mode SHALL invent missing cost or capability values. Legacy requests without `mode` SHALL retain their existing behavior when external metadata is unavailable.

#### Scenario: Fresh metadata supports free mode
- **WHEN** a cached metadata snapshot is at most one hour old and contains an active zero-price candidate
- **THEN** free mode may include that candidate subject to capability and connected-catalog filtering

#### Scenario: Stale metadata blocks free mode
- **WHEN** the newest metadata snapshot is older than one hour but no older than six hours
- **THEN** free mode returns no metadata-based candidates and includes `stale_metadata` rather than claiming a model is free

#### Scenario: Stale metadata is disclosed for economy mode
- **WHEN** the newest metadata snapshot is older than one hour but no older than six hours
- **THEN** economy mode may return ranked candidates and marks the response stale with source age and warning

#### Scenario: Metadata failure does not block manual configuration
- **WHEN** models.dev cannot be accessed and an administrator manually selects a model from the connected OpenCode catalog
- **THEN** the existing manual model Apply flow remains available and continues using its existing catalog and runtime verification rules

### Requirement: Free-mode filtering

In explicit `free` mode, a candidate SHALL have input and output prices both equal to zero, a non-deprecated lifecycle status, and the minimum capabilities required by the Agent category. A missing or unknown price SHALL exclude the candidate from free mode. Free mode SHALL NOT substitute a paid or unknown-cost candidate when no qualifying candidate exists.

#### Scenario: Active capable free candidate is eligible
- **WHEN** a connected Provider has a fresh, non-deprecated model with zero input/output price and the Agent-required reasoning and tool capabilities
- **THEN** the candidate is eligible for free-mode ranking

#### Scenario: Free candidate lacks a required capability
- **WHEN** a zero-price candidate does not support a capability required by the target Agent category
- **THEN** the candidate is excluded from that Agent's free suggestions

#### Scenario: No active free candidate exists
- **WHEN** all candidates are paid, unknown-cost, deprecated, stale, unavailable, or capability-incompatible
- **THEN** the response reports no free suggestion and does not return a paid fallback

### Requirement: Deterministic economy ranking

In explicit `economy` mode, the system SHALL first exclude deprecated, disconnected, unmatched, capability-incompatible, and context-inadequate candidates. A candidate SHALL be context-inadequate only when its normalized context limit is missing or unknown; any known context limit SHALL be treated as adequate for this version. It SHALL rank the remaining candidates by the following stable tuple in order: effective cost ascending, existing Agent capability score descending, and complete `provider/model` reference ascending. Effective cost SHALL be calculated as `inputPrice * 0.6 + outputPrice * 0.4` using the catalog base prices; a missing input or output price SHALL have infinite effective cost and SHALL rank after candidates with known prices. The response SHALL identify this ranking basis.

#### Scenario: Lower effective cost ranks first
- **WHEN** two candidates satisfy the same Agent capability and context requirements and one has lower calculated effective cost
- **THEN** the lower-cost candidate ranks first in economy mode

#### Scenario: Stable economy tie-breaker
- **WHEN** candidates have equal effective cost and capability score
- **THEN** the lexicographically smaller complete Provider/model reference ranks first

#### Scenario: Unknown economy cost is deprioritized
- **WHEN** a candidate has an unknown input or output price
- **THEN** it ranks after candidates with known effective cost and is labeled with incomplete pricing metadata

### Requirement: Deterministic performance ranking

In explicit `performance` mode, the system SHALL exclude deprecated, disconnected, unmatched, capability-incompatible, and context-inadequate candidates. A candidate SHALL be context-inadequate only when its normalized context limit is missing or unknown; any known context limit SHALL be treated as adequate for this version. It SHALL rank candidates by benchmark score descending when comparable benchmark data exists, then existing Agent capability score descending, context limit descending, output limit descending, metadata freshness descending, and complete `provider/model` reference ascending. If no comparable benchmark data exists for the considered candidates, the response SHALL set `heuristic: true` and explain that the recommendation is based on catalog capabilities and limits rather than measured performance.

#### Scenario: Performance ranking uses comparable benchmark data
- **WHEN** comparable benchmark scores exist for two eligible candidates
- **THEN** the candidate with the higher score ranks first and the response identifies the benchmark signal

#### Scenario: Performance ranking falls back to capability and limits
- **WHEN** no comparable benchmark data exists
- **THEN** the system ranks by the specified capability, context, output, freshness, and reference rules and sets `heuristic: true`

#### Scenario: Performance tie is deterministic
- **WHEN** candidates have equal values for all available ranking dimensions
- **THEN** the lexicographically smaller complete Provider/model reference ranks first

### Requirement: Suggestion response schema

For explicit mode requests, the endpoint SHALL return a response with this shape:

```json
{
  "mode": "free|economy|performance",
  "providers": ["provider-id"],
  "sourceStatus": "fresh|stale|unavailable",
  "sourceAgeMs": 0,
  "warnings": ["metadata_unavailable|stale_metadata|incomplete_metadata"],
  "suggestions": {
    "agent-name": {
      "model": "provider/model",
      "metadata": {
        "inputPrice": 0,
        "outputPrice": 0,
        "contextLimit": 1048576,
        "outputLimit": 131072,
        "reasoning": true,
        "toolCall": true,
        "structuredOutput": true,
        "deprecated": false
      },
      "reason": "human-readable ranking explanation",
      "heuristic": false
    }
  }
}
```

`sourceAgeMs`, metadata fields, and `heuristic` MAY be omitted when not applicable, but `mode`, `providers`, `sourceStatus`, `warnings`, and `suggestions` SHALL be present for explicit mode requests. Legacy requests without `mode` SHALL retain the existing response compatibility contract.

#### Scenario: Successful response is explainable
- **WHEN** an explicit mode request produces an eligible recommendation
- **THEN** the response contains the selected mode, effective Provider scope, model reference, available metadata, ranking reason, source status, and warnings

#### Scenario: Agent has no recommendation
- **WHEN** no candidate survives the selected mode's filters for an Agent
- **THEN** that Agent has no model recommendation and the response includes a bounded reason or warning without returning an arbitrary fallback

### Requirement: Preserve manual and apply safety behavior

Mode-aware Generate Suggestions SHALL perform filtering and ranking only; it SHALL NOT run inference probes over candidates or modify persisted configuration. An administrator SHALL explicitly accept a recommendation before it enters the existing pending batch Apply flow. Applying an accepted suggestion SHALL use the validated single-primary `provider/model` format and the existing snapshot, restart, runtime verification, probe, and rollback behavior.

#### Scenario: Suggestions do not probe or persist
- **WHEN** an administrator generates suggestions
- **THEN** the system performs no candidate inference probe, does not restart managed OpenCode, and does not modify `omo.jsonc`

#### Scenario: Accepted suggestion uses existing Apply flow
- **WHEN** an administrator accepts a recommendation and applies it
- **THEN** the system validates the explicit model reference and executes the existing apply-and-verify contract

#### Scenario: Manual selection remains authoritative
- **WHEN** an administrator manually edits an Agent instead of accepting a recommendation
- **THEN** the manual pending value is preserved and Generate Suggestions does not overwrite it

#### Scenario: Accepted suggestion fails verification
- **WHEN** an accepted recommendation fails post-apply verification or a conclusive probe
- **THEN** the system reports the existing failure status and rollback behavior rather than treating the recommendation as effective
