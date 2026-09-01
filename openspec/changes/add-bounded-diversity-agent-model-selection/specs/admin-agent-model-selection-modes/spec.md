## ADDED Requirements

### Requirement: Bounded tie-only diversity for explicit modes

For explicit suggestion modes (`free`, `economy`, `performance`), after filtering by role hard gates and after ranking by existing mode keys (effective cost and roleScore/capabilityScore), the system SHALL apply a deterministic, bounded diversity selection **only within the leading exact-tie group**. The exact-tie group SHALL be defined as all eligible candidates whose primary ranking keys are exactly equal to the top candidate:

- `free`: equal `roleScore`.
- `economy`: equal `effectiveCost` (including `Infinity` for unknown price) and equal `roleScore`.
- `performance`: equal `roleScore`.

The system SHALL maintain a run-local ledger scoped to one `suggestForMode()` invocation tracking `modelReuse` (times a `provider/model` reference has already been selected) and `providerReuse` (times a provider has already been selected). The ledger SHALL be initialized empty, updated immediately after each agent's winner is chosen, and SHALL NOT be persisted, transmitted, or used to create new config keys or telemetry.

Within the exact-tie group, selection SHALL be deterministic in this total order:

1. For high-risk roles `review` and `deep-reasoning`, when the coding counterpart selection (`sisyphus-junior`) is already known in the ledger, candidates with a different `provider/model` than the counterpart SHALL rank before candidates equal to it. When the counterpart is unknown in the ledger, this rule is a no-op.
2. Lower `modelReuse` count first.
3. Lower `providerReuse` count first.
4. Lexicographically smaller `provider/model` reference first via `compareReferences`.

The bounded diversity step SHALL never select a candidate outside the exact-tie group and SHALL never demote a strictly higher-ranked candidate. When the exact-tie group has size one, the sole candidate remains the winner and the ledger advances without diversification. When bounded diversity changes the winner relative to the lexicographically first element of the exact-tie group, the existing `reason` string SHALL include a concise marker (` · diversity` for generic diversity, ` · cross-review` when the cross-review rule contributed) and SHALL remain bounded to 200 characters via `capReason`. The marker SHALL be absent when diversity did not decide. No new API response fields, config keys, persistence, telemetry, randomness, weighted penalties, forced changes, model-name inference, or hard provider exclusion SHALL be introduced.

#### Scenario: Exact tie diversifies deterministically

- **WHEN** two eligible candidates for an agent have exactly equal primary keys (e.g., same `effectiveCost` and same `roleScore` in economy) and the ledger shows one provider/model already selected for a prior agent
- **THEN** the agent receives the tied candidate with lower `modelReuse`/`providerReuse` (and lexicographic tie-breaker if still tied), deterministically, without affecting any agent whose top candidate is strictly better

#### Scenario: Non-tied winner is preserved

- **WHEN** the top candidate has a strictly lower `effectiveCost` or strictly higher `roleScore` than any alternative
- **THEN** diversity does not change the winner and no diversity marker appears in the reason

#### Scenario: Reuse and provider count ordering

- **WHEN** an exact-tie group contains candidates that reuse a heavily selected provider versus a never-selected one
- **THEN** the never-selected provider's candidate is preferred within the tie, after model-reuse ordering, before lexicographic fallback

#### Scenario: High-risk cross-review separation

- **WHEN** a `review` or `deep-reasoning` agent is evaluated and `sisyphus-junior` has already been assigned a model within the same explicit suggestion call, and the exact-tie group for that agent contains both the counterpart's model and at least one alternative tied model
- **THEN** the alternative is selected and the reason includes the cross-review marker

#### Scenario: Unknown counterpart is no-op

- **WHEN** a `review` or `deep-reasoning` agent is evaluated before `sisyphus-junior` (or when `sisyphus-junior` is not among the requested agents)
- **THEN** the high-risk cross-review preference does not apply; normal tie diversity ordering applies via reuse counts and reference

#### Scenario: Single candidate falls back deterministically

- **WHEN** only one eligible candidate exists for the agent
- **THEN** it is selected with no diversity marker and ledger accounting proceeds normally

#### Scenario: Input permutation remains deterministic

- **WHEN** the same set of eligible candidates and the same ledger start state are evaluated with different input catalog orderings
- **THEN** the set of winners remains deterministic because the pre-diversity sort is total-order and the within-tie diversity order is total-order; only ledger insertion order (agent order) deterministically affects subsequent ties

#### Scenario: Reason marker is bounded

- **WHEN** bounded diversity actually decides the winner
- **THEN** `reason` contains the marker and remains at most 200 characters; when diversity did not decide, the marker is absent

### Requirement: Legacy and automatic fallback diversity boundary

The bounded tie-only diversity step SHALL apply only to the explicit-mode pure function `suggestForMode()` (and its route wrapper `suggestExplicit`). The legacy capability-only `suggest()` path and the automatic reconciler fallback inside `runOnce()` SHALL retain their existing deterministic capability ranking and per-candidate health-probe behavior bounded by `MAX_PROBES`. They SHALL NOT apply bounded diversity unless it can be shown to preserve probe budget, `MAX_PROBES`, and apply/verify/rollback safety. In this change, those paths remain unchanged and the boundary is documented. No probe-budget or persistence changes are introduced.

#### Scenario: Legacy suggestion contract preserved

- **WHEN** an API caller omits `mode` and invokes legacy `suggest()`
- **THEN** candidates are still ranked by capability score and lexicographic reference and probed sequentially within budget, regardless of bounded diversity in explicit mode

#### Scenario: Automatic fallback retains probe and rollback safety

- **WHEN** automatic reconciliation replaces an unavailable configured model via `runOnce()`
- **THEN** the replacement is still selected by sequential capability ranking and per-candidate probing bounded by `MAX_PROBES`, without ledger-based diversification that could increase probes or alter rollback ordering

## MODIFIED Requirements

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

`sourceAgeMs`, metadata fields, and `heuristic` MAY be omitted when not applicable, but `mode`, `providers`, `sourceStatus`, `warnings`, and `suggestions` SHALL be present for explicit mode requests. Legacy requests without `mode` SHALL retain the existing response compatibility contract. The `reason` field SHALL remain bounded to 200 characters and MAY include a single bounded diversity marker (` · diversity` or ` · cross-review`) only when bounded tie-only diversity actually decided the winner; otherwise the marker SHALL be absent. No new fields SHALL be added.

#### Scenario: Successful response is explainable

- **WHEN** an explicit mode request produces an eligible recommendation
- **THEN** the response contains the selected mode, effective Provider scope, model reference, available metadata, ranking reason (including diversity marker only when it decided), source status, and warnings

#### Scenario: Agent has no recommendation

- **WHEN** no candidate survives the selected mode's filters for an Agent
- **THEN** that Agent has no model recommendation and the response includes a bounded reason or warning without returning an arbitrary fallback
