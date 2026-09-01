## ADDED Requirements

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

## MODIFIED Requirements

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
