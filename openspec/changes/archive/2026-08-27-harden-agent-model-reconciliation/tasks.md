## 1. Provider-Scoped Probe Cache

- [x] 1.1 Add failing unit tests for canonical provider-auth serialization and full SHA-256 fingerprinting, including object-key order independence and a changed credential producing a different fingerprint; implement the minimum helper and verify with `cd src/admin && bun test lib/model-probe.test.ts`
- [x] 1.2 Add failing tests that a cached probe is reused only for the same provider fingerprint and model, that changing provider A does not invalidate provider B, and that legacy bare-model cache keys are treated as misses; implement the provider-scoped cache identity and verify with `cd src/admin && bun test lib/model-probe.test.ts`
- [x] 1.3 Add failing tests for `invalidateProbeCacheForProvider(providerID)` removing only the affected provider and never exposing credentials or fingerprints; implement eager provider-local invalidation and verify with `cd src/admin && bun test lib/model-probe.test.ts`
- [x] 1.4 Update `scripts/agent-model-health.sh` to consume the provider-scoped cache format, add shell coverage for same-provider invalidation and unrelated-provider retention, and verify with `test/test-agent-model-health.sh`

## 2. Single-Primary Admin Contract

- [x] 2.1 Add failing request-validation tests that `entries` accepts zero or one item and rejects multiple items with HTTP 400 and no write; implement the zero-or-one rule and verify with `cd src/admin && bun test routes/agent-models.test.ts`
- [x] 2.2 Add failing configuration-write tests that setting one primary writes `model` and optional `variant`, removes target-Agent `models` and `fallback_models`, preserves `$schema`, and leaves unrelated Agents unchanged; implement the atomic write and verify with `cd src/admin && bun test lib/agent-model-config.test.ts`
- [x] 2.3 Add a failing clear test that zero entries remove target-Agent `model`, `variant`, `models`, and `fallback_models` without changing unrelated settings; implement clear behavior and verify with `cd src/admin && bun test lib/agent-model-config.test.ts`

## 3. Serialized Reconciliation Core

- [x] 3.1 Add failing tests that only one reconciliation writer runs at a time and a trigger arriving during a run produces one pending rerun with the latest scope; implement the shared lock and pending marker and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`
- [x] 3.2 Add failing tests that reconciliation reuses the existing catalog/connectivity checks and temporary-session inference result classification rather than a second probe path; implement the reconciler dependency boundary and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`
- [x] 3.3 Add failing tests that a run with no configuration change performs no write and no managed restart; implement no-op detection and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`

## 4. Deterministic Single-Primary Fallback

- [x] 4.1 Add failing tests that a healthy configured primary remains unchanged and a healthy runtime-resolved default remains unset; implement current/default evaluation and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`
- [x] 4.2 Add failing tests for the existing `reasoning`, `exploration`, and `general` capability ranking plus ascending complete-model-reference tie-breaking; move or reuse the current policy in the reconciler and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`
- [x] 4.3 Add failing tests that only disconnected, `unavailable`, or `retired` current models permit replacement, while `retryable`, `unreachable`, and `mismatch` preserve configuration; implement the conclusive-replacement rule and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`
- [x] 4.4 Add failing tests that candidates are probed in deterministic order, the first healthy candidate becomes the sole primary, no healthy candidate causes no write, and probing stops at configured count/concurrency limits; implement bounded selection and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`

## 5. Managed Restart and Rollback Matrix

- [x] 5.1 Add failing tests that a model change restarts managed OpenCode through its pid-file lifecycle without invoking Compose or changing the `ai-dev` container ID; implement `restartManagedOpenCode()` and verify with `cd src/admin && bun test lib/restart-ai-dev.test.ts`
- [x] 5.2 Add failing transactional tests for snapshot, atomic write, managed restart, resolution/request verification, and the existing real probe; implement the apply pipeline and verify with `cd src/admin && bun test lib/agent-models.test.ts lib/agent-model-reconciler.test.ts`
- [x] 5.3 Add failing matrix tests that restart failure and post-restart `unavailable`/`retired` restore the snapshot and previous runtime, while `mismatch` keeps the write as `runtime_mismatch` and `retryable`/`unreachable` keep it as `unverified`; implement result handling and verify with `cd src/admin && bun test lib/agent-models.test.ts lib/agent-model-reconciler.test.ts`
- [x] 5.4 Add a failing recovery test that snapshot-restore or recovery-restart failure returns `rollback_failed`; implement rollback failure reporting and verify with `cd src/admin && bun test lib/agent-model-reconciler.test.ts`

## 6. Three Trigger Adapters

- [x] 6.1 Add failing route tests that successful `POST /api/providers/:name/keys`, `PUT /api/providers/:name/keys/:keyId/active`, and `DELETE /api/providers/:name/keys/:keyId` invalidate only that provider and trigger reconciliation after the credential restart is ready; wire the API-key routes and verify with `cd src/admin && bun test routes/providers.test.ts`
- [x] 6.2 Add failing route tests that successful `POST /api/providers/openai/oauth/apply` and `POST /api/providers/openai/oauth/disconnect` invalidate only OpenAI and trigger reconciliation after restart readiness, while failed mutations do not trigger it; wire the OAuth routes and verify with `cd src/admin && bun test routes/providers-oauth.test.ts`
- [x] 6.3 Add failing route tests that a valid `PUT /api/agent-models/:agent` uses the reconciliation apply policy and that invalid requests never trigger a write or restart; replace the direct apply path and verify with `cd src/admin && bun test routes/agent-models.test.ts`
- [x] 6.4 Add a failing startup test that managed-server readiness invokes the shared reconciliation entrypoint exactly once; reduce `scripts/reconcile-agent-models.sh` to a trigger-only adapter with no selection or configuration-write logic and verify with `test/test-agent-model-reconcile.sh`

## 7. Integration and Coherence Verification

- [x] 7.1 Add integration coverage for startup, provider credential mutation, and Agent Model save, including real model metadata verification and byte-identical restoration on rollback; verify with `test/test-agent-model-e2e.sh`
- [x] 7.2 Add integration coverage that rotating provider A causes provider A to re-probe while provider B reuses an unexpired cached result; verify with `test/test-agent-model-health-parallel.sh`
- [x] 7.3 Run the complete Admin unit suite and verify it passes with `cd src/admin && bun test`
- [x] 7.4 Run the repository integration suite and verify it passes with `test/run-tests.sh`
- [x] 7.5 Validate the completed planning contract and verify zero errors with `openspec validate harden-agent-model-reconciliation --type change --strict`
