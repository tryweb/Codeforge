## 1. Spec and Design

- [x] 1.1 Create change `add-bounded-diversity-agent-model-selection` proposal/design covering exact-tie ledger, cross-review, bounded marker, legacy boundary, and supersede prior no-diversity decision.
- [x] 1.2 Author spec delta for `admin-agent-model-selection-modes` adding bounded tie-only diversity and legacy boundary requirements with scenarios.
- [x] 1.3 Validate with `openspec validate add-bounded-diversity-agent-model-selection --strict`.

## 2. Bounded Diversity Policy

- [x] 2.1 Add failing tests for non-tied winner preservation across free/economy/performance.
- [x] 2.2 Implement run-local ledger and exact-tie group detection in `src/admin/lib/agent-model-suggestion-policy.ts`; verify non-tied tests pass.
- [x] 2.3 Add failing tests for tied candidate deterministic diversification, reuse-count and provider-count ordering, deterministic input-permutation, and single-candidate fallback; implement tie diversification ordering and verify.
- [x] 2.4 Add failing tests for high-risk cross-review separation (known vs unknown counterpart); implement cross-review preference within tie group and verify.
- [x] 2.5 Add failing tests for bounded reason marker presence/absence and 200-char bound; extend `reasonFor` to include marker only when diversity decides and verify.

## 3. Legacy and Integration Boundary

- [x] 3.1 Verify legacy `suggest` and reconciler `runOnce` probe budget and rollback behavior unchanged; document boundary in spec/design; add regression test that legacy path remains capability-ordered.
- [x] 3.2 Verify explicit path remains probe-free and Provider-scoped; ensure no new API fields, config keys, persistence, or telemetry.

## 4. Verification

- [x] 4.1 Run `bun test` targeted suites and `tsc --noEmit`; report exact pass/fail counts and pre-existing failures.
- [x] 4.2 Run `openspec validate add-bounded-diversity-agent-model-selection --strict` and `openspec validate add-role-aware-agent-model-scoring --strict` sanity check.
- [x] 4.3 Run full relevant tests (`agent-model-suggestion-policy`, `agent-model-reconciler`, `routes/agent-models`, `views/agent-models`) and confirm no regressions beyond intentionally changed duplicate-winner contracts.
