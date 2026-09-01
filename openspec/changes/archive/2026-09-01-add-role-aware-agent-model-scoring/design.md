## Context

See `proposal.md` for motivation. Explicit mode suggestions currently join the connected OpenCode catalog with normalized models.dev metadata, apply broad `reasoning`, `exploration`, or `general` capability rules, and independently select one model per Agent. Performance then rewards raw context and output limits without an Agent-specific saturation point. The path is intentionally deterministic, probe-free, and separate from Apply verification.

The current trustworthy inputs are price, context/output limits, reasoning, tool calling, structured output, deprecation, generic benchmark score, live attachment capability, and metadata freshness. Model names do not establish latency, coding specialization, or vision support.

## Goals / Non-Goals

**Goals:**

- Distinguish Agent duties with a small static role registry.
- Reject candidates that do not meet a role's mandatory capabilities or minimum limits.
- Stop oversized context/output limits from receiving unbounded ranking advantage.
- Keep free cost eligibility, economy cost priority, deterministic output, and the existing response schema.
- Explain the selected role and decisive supported dimensions through the existing `reason` and `heuristic` fields.

**Non-Goals:**

- No telemetry, latency, throughput, coding, reasoning, or vision benchmark ingestion.
- No per-field evidence or confidence platform.
- No new API score or dimension fields.
- No assignment diversity penalty or requirement that Agents use different models.
- No inference from model names such as `Flash`, `Pro`, `Code`, or `Vision`.
- No persisted, user-editable, or UI-configurable role profiles.
- No change to the legacy request path when `mode` is omitted.

## Decisions

### Use eight static roles instead of one profile per Agent

The policy maps known Agents to these roles and maps unknown Agents to `general`:

| Role | Agents |
| --- | --- |
| `deep-reasoning` | `oracle`, `metis` |
| `planning` | `plan` |
| `review` | `momus` |
| `coding` | `sisyphus-junior` |
| `exploration` | `explore` |
| `research` | `librarian` |
| `multimodal` | `multimodal-looker` |
| `general` | `general` and unknown Agents |

Each role uses the existing dimensions `benchmark`, `reasoning`, `toolCall`, `attachment`, `structuredOutput`, `contextFit`, and `outputFit`. Weights use only `0`, `1`, `2`, and `4` to avoid false precision:

| Role | benchmark | reasoning | toolCall | attachment | structured | context | output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deep-reasoning | 4 | 4 | 1 | 0 | 1 | 2 | 1 |
| planning | 2 | 4 | 1 | 0 | 1 | 4 | 2 |
| review | 4 | 4 | 1 | 0 | 2 | 2 | 1 |
| coding | 4 | 1 | 4 | 0 | 2 | 2 | 2 |
| exploration | 1 | 0 | 4 | 0 | 0 | 2 | 1 |
| research | 2 | 1 | 4 | 0 | 0 | 4 | 2 |
| multimodal | 2 | 1 | 2 | 4 | 1 | 2 | 1 |
| general | 2 | 1 | 4 | 1 | 1 | 2 | 1 |

Alternative considered: nine independently tunable Agent profiles with decimal weights. Rejected because the available metadata cannot justify that precision and duplicated profiles would drift.

### Apply hard gates before scoring

Every candidate must be connected, identity-matched, non-deprecated, and have known context/output limits at or above the role minimum. Required capabilities must be explicitly `true`; unknown is not sufficient.

| Role | Required capabilities | Minimum / preferred context | Minimum / preferred output |
| --- | --- | ---: | ---: |
| deep-reasoning | reasoning, toolCall | 128K / 256K | 8K / 64K |
| planning | reasoning, toolCall | 128K / 512K | 8K / 64K |
| review | reasoning, toolCall | 128K / 256K | 8K / 64K |
| coding | toolCall | 64K / 128K | 8K / 64K |
| exploration | toolCall | 32K / 128K | 4K / 32K |
| research | toolCall | 128K / 1M | 8K / 64K |
| multimodal | toolCall, attachment | 64K / 256K | 4K / 32K |
| general | toolCall | 64K / 256K | 8K / 64K |

`attachment` is the only live multimodal signal available in this version. The policy and reason text must not claim verified vision support.

Alternative considered: allow unknown required capabilities with a score penalty. Rejected because a highly ranked but unusable recommendation is worse than returning no recommendation.

### Saturate context and output fit at the role preference

For a limit `value`, minimum `min`, and preference `preferred`, fit is:

```text
clamp((value - min) / (preferred - min), 0, 1)
```

A candidate below `min` has already been excluded. A candidate at or above `preferred` receives `1`, so excess capacity gives no additional advantage. If a future profile has equal minimum and preference, an eligible candidate receives `1`.

Alternative considered: retain raw limit descending. Rejected because it recreates the current tendency for the largest-context model to win every role.

### Calculate one normalized role score

Boolean dimensions score `1` only when explicitly true and otherwise `0`. Benchmark scores are min-max normalized within the eligible role/mode cohort. A benchmark is comparable only when at least two eligible candidates have a benchmark value. When comparable data exists, a candidate with a missing benchmark receives `0`. When fewer than two values exist, the benchmark dimension is removed and the remaining active weights are renormalized.

```text
roleScore = sum(activeWeight × dimensionScore) / sum(activeWeight)
```

Alternative considered: fill missing benchmark data with `0.5` and multiply by a separate confidence score. Rejected because it can reward missing data and introduces a second speculative scoring system.

### Preserve clear mode ordering

- Free: existing fresh, zero-price gates → role score descending → reference ascending.
- Economy: existing effective cost ascending → role score descending → reference ascending.
- Performance: role score descending → reference ascending.

The policy does not combine price and role quality into arbitrary decimal mode weights. The selected suggestion sets `heuristic: true` when the eligible cohort lacks comparable benchmark data. `reason` names the mode, role, role score, and bounded decisive dimensions. No response fields are added.

Alternative considered: weighted cost/quality mode formulas. Rejected because their product trade-off is not empirically calibrated and would make economy behavior less predictable.

### Keep independent per-Agent winners

Each Agent still receives its own highest-ranked eligible candidate. Duplicate models remain valid; role differentiation may naturally produce distinct winners but does not force them.

Alternative considered: exclude models already selected by another Agent. Rejected because diversity is not a performance measure and could deliberately assign a worse model.

## Risks / Trade-offs

- [Static thresholds may exclude a useful smaller model] → Keep profiles small, deterministic, and covered by boundary tests; adjustment remains a policy-only change.
- [Generic benchmark is not task-specific] → Use it as one weighted dimension rather than the universal first key and mark no-comparison results heuristic.
- [Attachment does not prove full visual quality] → Require the live capability but describe it as attachment eligibility, not verified vision performance.
- [Unknown Agents use a generic profile] → Keep the current safe tool-call requirement and identify the fallback role in the reason.
- [Weights remain product judgment] → Use coarse integer weights and verify outcomes against fixed catalog fixtures before tuning.

## Migration Plan

1. Add tests that lock role mapping, gates, saturation, scoring, and deterministic ordering.
2. Replace only the explicit-mode ranking internals while retaining request and response types.
3. Run route and UI regressions to confirm legacy no-mode behavior, pending changes, and Apply safety are unchanged.
4. Roll back by reverting the role-aware policy; persisted Agent configuration is unaffected.
