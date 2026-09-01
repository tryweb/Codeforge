## Why

The explicit Agent Models modes currently rank broad Agent categories with raw model limits, so one large model can win for every subagent even when their duties require different capabilities. The recommendation policy should use role-specific requirements and bounded fit scores while remaining deterministic, explainable, and grounded only in metadata the system already trusts.

## What Changes

- Replace the explicit-mode category-only ranking with static role profiles for deep reasoning, planning, review, coding, exploration, research, multimodal analysis, and general work.
- Apply role-specific hard capability and minimum context/output gates before ranking candidates.
- Score context and output limits against role-specific preferred values with saturation, so capacity beyond a role's need does not keep increasing rank.
- Preserve mode semantics: free remains zero-cost and fresh-only, economy remains cost-first, and performance remains role-fit-first.
- Keep ranking deterministic with complete `provider/model` reference as the final tie-breaker.
- Make the existing `reason` and `heuristic` fields explain the role and deciding dimensions without changing the response schema.
- Add regression coverage for role differentiation, hard gates, saturation, missing benchmarks, stable ordering, and unchanged legacy behavior.
- Exclude telemetry, evidence/confidence platforms, new API score dimensions, diversity penalties, model-name inference, and persisted or UI-configurable profiles from this version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-agent-model-selection-modes`: Explicit free, economy, and performance suggestions use role-aware eligibility and ranking instead of category-only capability and unbounded model-limit ordering.

## Impact

- Affects the pure suggestion policy and its unit tests under `src/admin/lib/`.
- May update route and view tests that assert recommendation reasons, while retaining the current explicit-mode response fields and legacy no-mode response contract.
- Uses the existing connected Provider catalog, models.dev metadata, and live capability catalog; no new dependency, persistence format, inference probe, restart, or Apply behavior is introduced.
