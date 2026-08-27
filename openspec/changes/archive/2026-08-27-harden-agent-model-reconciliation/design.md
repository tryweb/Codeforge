## Context

See `proposal.md` for motivation. The current system has separate startup-shell and Admin-save paths that can choose, write, restart, and verify models with different rules. A real temporary-session inference probe already exists in `model-probe.ts`; this change reuses it rather than introducing another probe mechanism.

The pinned OMO schema is strict. Agent entries containing unsupported keys such as `fallback_models` can invalidate the override, so this design persists one primary model only. The provider auth store is keyed by provider, which permits cache health to follow the credential that actually served the probe instead of the whole auth file.

## Goals / Non-Goals

**Goals:**
- Route managed-server-ready startup, provider credential mutation, and Agent Model save through one reconciliation policy.
- Serialize writes across trigger sources and coalesce redundant pending work without introducing a public job API.
- Reuse catalog/connectivity checks and the existing `probeModel()` inference call as one proof ladder.
- Choose a single fallback primary deterministically when the current assignment is missing or conclusively unusable.
- Scope cached probe results and invalidation to one provider credential.
- Apply model changes with a managed-OpenCode restart and an explicit rollback matrix.

**Non-Goals:**
- Persisted fallback chains or any new `omo.jsonc` metadata key.
- Persisted assignment provenance or inherited-assignment writes.
- Runtime request-error interception after reconciliation completes.
- A reconciliation status endpoint, new UI banner, or Admin UI redesign.
- Provider-definition edit triggers; only API-key and OAuth credential mutations are included.
- Catalog-wide probing, provider optimization, or cost-based model migration.
- Spec-normative concurrency, budget, or debounce constants.

## Decisions

### D1: One reconciliation policy with trigger adapters

All three triggers call the same reconciliation entrypoint. The startup shell remains only as a trigger adapter after managed OpenCode readiness; it no longer selects models or writes configuration. Admin provider and Agent Model routes invoke the same entrypoint. A shared lock serializes runs across processes, and one pending marker requests a rerun when another trigger arrives while the lock is held.

This keeps the current startup location while removing duplicate selection and write logic. An in-memory queue alone was rejected because startup and Admin triggers can originate in different processes.

### D2: Reuse the existing usability proof

The proof ladder is:
1. the model exists in the connected-provider catalog;
2. its provider is connected under the current credential;
3. the existing `probeModel()` temporary-session inference returns `healthy` for the requested provider/model.

Only step 3 proves usability. `retryable` and `unreachable` are inconclusive, not proof of failure. A second probe subsystem was rejected because the existing implementation already creates, exercises, and deletes a temporary session.

### D3: Persist one primary and reject submitted chains

`PUT /api/agent-models/:agent` accepts zero entries to clear the primary or one entry to set it. More than one entry is rejected because the pinned OMO schema cannot safely persist a fallback chain. Setting a primary removes stale target-Agent `models` and `fallback_models` keys; unrelated Agent entries remain unchanged.

External fallback-policy storage and an OMO upgrade were rejected to keep this change limited to the three original triggers.

### D4: Deterministic single-primary fallback selection

For every configurable Agent:
1. If a configured primary exists, keep it when its provider is connected and its probe is `healthy`.
2. If no primary exists, probe the runtime-resolved default first. When healthy, leave the Agent unset so native inheritance remains intact.
3. A missing primary proceeds to candidate selection when the resolved default is absent, disconnected, `unavailable`, or `retired`.
4. A configured primary proceeds to candidate selection only when its provider is disconnected or its probe is `unavailable` or `retired`.
5. Candidate models come from connected providers and are ranked by the existing Agent category policy (`reasoning`, `exploration`, or `general`). Higher capability score wins; the complete model reference is the stable ascending tie-breaker.
6. Probe candidates in ranked order within the run budget and write only the first `healthy` model.
7. If the current/default probe is `retryable`, `unreachable`, or `mismatch`, or no candidate is proven healthy, make no configuration change.

This preserves healthy assignments, retains native defaults when they work, and replaces only conclusively broken primaries. Alphabetical first-match selection was rejected because it ignores the existing Agent capability policy.

### D5: Provider-scoped credential fingerprint

The credential fingerprint is the full SHA-256 hex digest of canonical JSON for the affected provider's own auth-store entry. Canonicalization recursively sorts object keys and retains credential type and all values that affect authentication. The cache identity contains provider ID, fingerprint, and model reference.

Credential mutation performs eager invalidation for that provider. Cache reads also recompute the provider fingerprint; a mismatch is a cache miss. Unrelated providers retain their cache entries. Neither credentials nor fingerprints are written to logs or returned by an API.

Hashing the entire auth file was rejected because changing one provider would invalidate every provider. A truncated digest was rejected because the full digest has no material storage cost.

### D6: Bounded probing

Probe concurrency and maximum distinct probes per run are internal configuration defaults. Initial defaults are concurrency 3 and 12 distinct provider-credential/model combinations per run; changing these values does not alter the behavioral contract. Cache TTLs remain 24 hours for confirmed results and 5 minutes for retryable results.

The reconciler stops when it finds the first healthy candidate for an Agent and never scans the entire catalog solely to populate health data.

### D7: Managed-server-only restart

Model changes restart only managed OpenCode using the existing managed pid-file mechanism. They do not recreate the `ai-dev` container. The replacement process must answer its health endpoint before post-restart verification begins.

Full container recreation remains appropriate for environment or image changes, not Agent Model configuration.

### D8: Transaction and rollback matrix

The apply sequence is snapshot, atomic write, managed restart, post-restart resolution/connectivity/request verification, real probe, then commit the result.

| Outcome | Configuration action | Reported result |
|---|---|---|
| Atomic write fails before replacement | Do not restore because the original file remains authoritative | `write_failed` |
| Managed restart fails | Restore snapshot and attempt to restore the previous managed runtime | `restart_failed`, or `rollback_failed` if recovery fails |
| Post-restart probe is `unavailable` or `retired` | Restore snapshot and restart managed OpenCode with the previous configuration | `probe_failed`, or `rollback_failed` if recovery fails |
| Resolved/requested model differs | Keep the applied configuration | `runtime_mismatch` |
| Probe is `retryable` or `unreachable` | Keep the applied configuration | `unverified` |
| Resolution, request metadata, and probe confirm the model | Keep the applied configuration | `verified` |

`mismatch` is not a rollback trigger because it describes the effective runtime choice and must remain observable under the existing capability contract. Ambiguous transport failures are fail-open so transient outages do not cause configuration churn.

## Risks / Trade-offs

- **[Risk] An API-key or OAuth refresh changes its provider fingerprint and causes a new probe** -> Bounded probing and provider-local invalidation limit the cost.
- **[Risk] The fixed probe budget may leave later Agents unevaluated in a run** -> Retain their current settings and process them on the next trigger; never write an unproven candidate.
- **[Risk] Replacing a conclusively unusable configured primary loses the previous preference** -> Replacement occurs only for disconnected, `unavailable`, or `retired` models and is necessary to satisfy automatic availability without adding a second persistence model.
- **[Risk] Managed restart interrupts in-flight OpenCode work** -> Restart only when configuration actually changes and keep the container running.
- **[Trade-off] Single-primary storage cannot provide per-request fallback** -> Accepted because persisted chains are incompatible with the pinned OMO schema; fallback occurs during reconciliation instead.

## Migration Plan

1. Add provider-scoped cache identity and invalidation while retaining the existing probe result format where possible.
2. Restrict Admin Agent Model input to zero or one entry and keep the current primary-only OMO representation.
3. Introduce the shared reconciliation policy and wire the Admin save and credential mutation triggers.
4. Convert the startup shell to a trigger-only adapter for that policy.
5. Switch changed configurations to managed-OpenCode restart and the rollback matrix.

No configuration migration or new `omo.jsonc` key is required. Rollback of this implementation restores the prior startup and Admin paths; existing primary assignments remain readable.
