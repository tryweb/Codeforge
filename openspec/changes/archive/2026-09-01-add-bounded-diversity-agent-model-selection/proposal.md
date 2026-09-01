## Why

The current role-aware explicit Agent Models scoring (uncommitted `add-role-aware-agent-model-scoring`) intentionally rejected assignment diversity and keeps independent per-Agent winners with duplicate models allowed. Administrators reviewing role-specific recommendations have requested a small, explainable variation when candidates are truly indistinguishable on capability, cost, and role-fit — without introducing weighted diversity penalties, randomness, or model-name inference that would demote a genuinely better candidate.

## What Changes

- Add a deterministic, bounded diversity strategy that applies **only within the leading exact-tie group** after all existing capability eligibility, effective cost (economy), and roleScore/capabilityScore priorities have been evaluated. No non-tied candidate is ever demoted.
- Track model and provider reuse in a **run-local ledger** scoped to a single `suggestForMode()` invocation (no persistence, telemetry, config, or API shape changes). Ledger counts model and provider selections in deterministic agent order.
- For explicit mode suggestions (`free`, `economy`, `performance`), include a **concise diversity/cross-review marker** in the existing `reason` string only when diversity actually decides the winner; reason length remains bounded at 200 characters.
- High-risk roles `review` (`momus`) and `deep-reasoning` (`oracle`, `metis`) prefer a tied candidate different from the coding counterpart (`sisyphus-junior`) when that counterpart's selection is already known in the ledger; unknown counterpart is a no-op.
- Document the explicit-path boundary and keep legacy `suggest()` and automatic reconciler fallback (`runOnce`) unchanged unless bounded diversity can be applied without breaking probe budget, `MAX_PROBES`, or apply/verify/rollback safety — otherwise document that those paths intentionally do not diversify.
- Supersede the prior `add-role-aware-agent-model-scoring` decision that rejected diversity; keep all other role profiles, weights, gates, saturation, and deterministic reference tie-breaking unchanged.
- Add failing-first tests proving non-tied winner preservation, deterministic tie diversification, reuse/provider ordering, cross-review separation, single-candidate fallback, input-permutation determinism, bounded reason marker, and legacy contract preservation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-agent-model-selection-modes`: Explicit-mode ranking gains a bounded tie-only diversity step over the role-aware policy; legacy no-mode ranking and automatic fallback remain capability-only unless explicitly documented otherwise.

## Impact

- Touches only `src/admin/lib/agent-model-suggestion-policy.ts`, its unit tests, and lightweight OpenSpec / route-view regressions verifying legacy contracts and reason bounds.
- Preserves API request/response shapes, explicit path probe-free invariant, health-probing semantics, `MAX_PROBES`, apply/verify/rollback behavior, and deterministic fallback.
- No new config keys, env vars, providers, restart semantics, or dashboardथम changes beyond the bounded marker inside `reason`.
