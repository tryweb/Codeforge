## Why

Agent model availability is checked inconsistently across startup and Admin saves, and provider credential changes do not invalidate model health proven with the previous credential. The system needs one bounded reconciliation flow that runs at the three original trigger points, reuses the existing real inference probe, and applies deterministic fallback and rollback rules.

## What Changes

- Use one serialized Agent Model reconciliation flow for exactly three triggers:
  - managed OpenCode server becomes ready during startup;
  - provider credentials change through API-key add, activate, or delete, or OAuth apply or disconnect;
  - an Admin saves an Agent Model through `PUT /api/agent-models/:agent`.
- Reuse the existing temporary-session `probeModel()` inference check. Catalog presence and provider connectivity remain prerequisites but do not prove that a model is usable.
- Scope cached health results to the affected provider credential by combining the model reference with a fingerprint of that provider's canonical auth-store entry. Credential mutation invalidates that provider's cached results without invalidating unrelated providers.
- Define deterministic fallback selection without persisting a chain: keep an unset Agent unchanged when its resolved default passes the real probe; otherwise rank connected catalog candidates with the existing Agent capability policy, use the model reference as the stable tie-breaker, and probe candidates in order until the first healthy primary is found.
- Keep a healthy configured primary unchanged. Replace it only when its provider is disconnected or the real probe conclusively reports `unavailable` or `retired`. Make no change for `retryable`, `unreachable`, or `mismatch`, or when no candidate is proven healthy.
- Persist only one primary because the pinned OMO schema rejects `fallback_models`. An Admin save accepts zero entries to clear the primary or one entry to set it; multiple entries are rejected. No new metadata keys are written to `omo.jsonc`.
- Apply Agent Model changes transactionally using a managed-OpenCode restart rather than recreating the `ai-dev` container.
- Restore the previous configuration when the managed restart fails or the post-restart real probe conclusively reports `unavailable` or `retired`. Report `mismatch` as `runtime_mismatch` without rollback. Treat `retryable` and `unreachable` as inconclusive, keep the applied configuration, and report it as unverified.
- Bound probe concurrency and per-run probe count so startup and credential changes cannot scan the complete catalog or create unbounded API usage.

## Capabilities

### New Capabilities

- `agent-model-reconciliation`: Reconcile Agent Models at startup, provider credential mutation, and Agent Model save using deterministic candidate selection, real inference proof, provider-scoped health caching, and bounded execution.

### Modified Capabilities

- `admin-agent-model-config`: Enforce zero-or-one primary model input, restart only managed OpenCode for model changes, and use the explicit rollback matrix for post-restart verification outcomes.

## Impact

- **Agent Model flow**: Existing startup reconciliation and Admin apply behavior converge on one serialized reconciliation path that reuses `probeModel()`.
- **Provider credentials**: API-key and OAuth mutation routes invalidate only the affected provider's model-health cache and trigger reconciliation.
- **Configuration**: No `omo.jsonc` schema additions and no persisted fallback chain. Admin saves set or clear one primary; automatic reconciliation writes one proven-healthy primary only when the current assignment is missing or conclusively unusable.
- **Restart behavior**: Agent Model changes restart managed OpenCode without recreating the `ai-dev` container.
- **Tests**: Unit and integration coverage must exercise all three triggers, real inference reuse, deterministic single-primary fallback selection, provider-scoped invalidation, and each rollback outcome.
