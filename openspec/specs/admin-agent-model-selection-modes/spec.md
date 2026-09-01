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

### Requirement: Agent role profiles
For explicit selection modes, the system SHALL map each Agent to a stable role profile that defines required capabilities, minimum and preferred context/output limits, and coarse weights for supported metadata dimensions. The roles SHALL distinguish deep reasoning, planning, review, coding, exploration, research, multimodal analysis, and general work. Unknown Agents SHALL use the general profile. Profiles SHALL use only connected catalog capabilities and normalized metadata; model names SHALL NOT contribute eligibility or score.

Required capabilities SHALL be explicitly true. Deep reasoning, planning, and review roles SHALL require reasoning and tool calling; coding, exploration, research, and general roles SHALL require tool calling; multimodal analysis SHALL require tool calling and live attachment support. A candidate with a missing required capability or a context/output limit below the role minimum SHALL be excluded before scoring.

#### Scenario: Roles can produce different winners
- **WHEN** two Agents have different role profiles and the eligible models have different strengths in those supported dimensions
- **THEN** each Agent is ranked with its own role profile and may receive a different highest-ranked model

#### Scenario: Required capability is unknown
- **WHEN** a candidate lacks metadata for a capability required by the target role
- **THEN** the candidate is excluded instead of receiving a neutral or inferred capability score

#### Scenario: Unknown Agent uses the general profile
- **WHEN** an explicit suggestion request contains a configurable Agent without a named role mapping
- **THEN** the system applies the general role profile and identifies that role in the explanation

#### Scenario: Model name implies an unsupported trait
- **WHEN** a model name contains a term such as `Flash`, `Pro`, `Code`, or `Vision` without corresponding catalog capability or normalized metadata
- **THEN** the term does not affect eligibility or ranking

### Requirement: Saturated role-fit scoring
For each eligible candidate, the system SHALL compute context and output fit relative to the target role's minimum and preferred limits. Fit SHALL increase from zero at the minimum to one at the preferred limit and SHALL remain one above the preferred limit. Boolean dimensions SHALL score one only when explicitly true and zero otherwise.

The system SHALL calculate a role score as the weighted average of active supported dimensions. Weights SHALL use the coarse values zero, one, two, or four. Benchmark values SHALL be min-max normalized only when at least two eligible candidates have benchmark values. If fewer than two values exist, the benchmark dimension SHALL be omitted and remaining weights renormalized; the recommendation SHALL be heuristic. If comparable benchmark data exists, a candidate missing that value SHALL receive zero for the benchmark dimension.

#### Scenario: Excess context does not keep increasing score
- **WHEN** two candidates both meet or exceed the role's preferred context limit
- **THEN** both receive the same maximum context-fit score regardless of which has the larger raw context limit

#### Scenario: Candidate is below a role minimum
- **WHEN** a candidate's known context or output limit is below the target role minimum
- **THEN** the candidate is excluded before weighted scoring

#### Scenario: Benchmark data is not comparable
- **WHEN** fewer than two eligible candidates have benchmark values
- **THEN** benchmark is removed from the weighted score, remaining active weights are renormalized, and the suggestion is marked heuristic

### Requirement: Free-mode filtering
In explicit `free` mode, a candidate SHALL have input and output prices both equal to zero, a non-deprecated lifecycle status, and SHALL satisfy the target Agent role's hard capability and minimum context/output gates. A missing or unknown price SHALL exclude the candidate from free mode. Free mode SHALL rank eligible candidates by role score descending and complete `provider/model` reference ascending. Free mode SHALL NOT substitute a paid or unknown-cost candidate when no qualifying candidate exists.

#### Scenario: Active capable free candidate is eligible
- **WHEN** a connected Provider has a fresh, non-deprecated model with zero input/output price that meets the target role's capability and limit gates
- **THEN** the candidate is eligible and is ranked by role score

#### Scenario: Free candidate lacks a required capability
- **WHEN** a zero-price candidate does not explicitly support a capability required by the target Agent role
- **THEN** the candidate is excluded from that Agent's free suggestions

#### Scenario: No active free candidate exists
- **WHEN** all candidates are paid, unknown-cost, deprecated, stale, unavailable, or role-incompatible
- **THEN** the response reports no free suggestion and does not return a paid fallback

### Requirement: Deterministic economy ranking
In explicit `economy` mode, the system SHALL first exclude deprecated, disconnected, unmatched, and role-incompatible candidates. A candidate SHALL be role-incompatible when it lacks an explicitly required capability or its context/output limit is missing, unknown, or below the role minimum. It SHALL rank remaining candidates by the following stable tuple in order: effective cost ascending, role score descending, and complete `provider/model` reference ascending. Effective cost SHALL be calculated as `inputPrice * 0.6 + outputPrice * 0.4` using catalog base prices; a missing input or output price SHALL have infinite effective cost and SHALL rank after candidates with known prices. The response SHALL identify cost and role fit as the ranking basis.

#### Scenario: Lower effective cost ranks first
- **WHEN** two candidates satisfy the target role and one has lower calculated effective cost
- **THEN** the lower-cost candidate ranks first in economy mode regardless of role-score difference

#### Scenario: Role score breaks an economy cost tie
- **WHEN** eligible candidates have equal effective cost and different role scores
- **THEN** the candidate with the higher role score ranks first

#### Scenario: Stable economy tie-breaker
- **WHEN** candidates have equal effective cost and role score
- **THEN** the lexicographically smaller complete Provider/model reference ranks first

#### Scenario: Unknown economy cost is deprioritized
- **WHEN** a candidate has an unknown input or output price
- **THEN** it ranks after candidates with known effective cost and is labeled with incomplete pricing metadata

### Requirement: Deterministic performance ranking
In explicit `performance` mode, the system SHALL exclude deprecated, disconnected, unmatched, and role-incompatible candidates. A candidate SHALL be role-incompatible when it lacks an explicitly required capability or its context/output limit is missing, unknown, or below the role minimum. It SHALL rank candidates by role score descending and complete `provider/model` reference ascending. Role score SHALL include comparable normalized benchmark data as a role-weighted dimension and SHALL use saturated context/output fit rather than raw limits. If fewer than two eligible candidates have benchmark values, the response SHALL set `heuristic: true` and explain that the recommendation is based on role capabilities and bounded limits rather than comparable measured performance.

#### Scenario: Performance ranking uses comparable benchmark data
- **WHEN** at least two eligible candidates have benchmark scores
- **THEN** normalized benchmark contributes according to the target role's weight without overriding all other role dimensions

#### Scenario: Performance ranking falls back to capability and limits
- **WHEN** fewer than two eligible candidates have benchmark data
- **THEN** the system omits benchmark from the weighted average, ranks by the remaining role dimensions and reference, and sets `heuristic: true`

#### Scenario: Oversized limit does not dominate performance
- **WHEN** candidates exceed a role's preferred context or output limit
- **THEN** capacity above that preference provides no additional role score

#### Scenario: Performance tie is deterministic
- **WHEN** candidates have equal role scores
- **THEN** the lexicographically smaller complete Provider/model reference ranks first

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

### Requirement: Suggestion response schema
For explicit mode requests, the endpoint SHALL retain the existing response shape containing `mode`, `providers`, `sourceStatus`, optional `sourceAgeMs`, `warnings`, and per-Agent suggestions with `model`, available `metadata`, `reason`, and `heuristic`. The `reason` SHALL identify the selected mode, target role, role score, and bounded deciding dimensions. The change SHALL NOT add score-dimension or evidence-confidence response fields. Legacy requests without `mode` SHALL retain the existing response compatibility contract.

#### Scenario: Successful response is explainable
- **WHEN** an explicit mode request produces an eligible recommendation
- **THEN** the response identifies the selected mode, role, model reference, role-fit basis, source status, warnings, and whether benchmark comparison was heuristic

#### Scenario: Response schema remains compatible
- **WHEN** a mode-aware client processes a role-aware recommendation
- **THEN** all existing response fields retain their types and no new required field is introduced

#### Scenario: Agent has no recommendation
- **WHEN** no candidate survives the selected mode's role and mode filters for an Agent
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
