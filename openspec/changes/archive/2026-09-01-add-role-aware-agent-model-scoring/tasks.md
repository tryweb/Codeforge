## 1. Role Profiles and Eligibility

- [x] 1.1 Add failing policy tests for the eight Agent-role mappings, unknown-Agent general fallback, explicit required capabilities, and context/output minimum boundaries; verify `cd src/admin && bun test lib/agent-model-suggestion-policy.test.ts` fails for the new expectations.
- [x] 1.2 Add the static coarse-weight role profiles and hard-gate evaluation to `src/admin/lib/agent-model-suggestion-policy.ts`; verify the role mapping and eligibility tests pass with `cd src/admin && bun test lib/agent-model-suggestion-policy.test.ts`.
- [x] 1.3 Add a failing multimodal test proving a model name cannot substitute for live attachment support, then implement attachment-based eligibility using the existing capability catalog; verify the targeted policy test passes.

## 2. Saturated Role-Fit Scoring

- [x] 2.1 Add failing unit tests for context/output fit at below-minimum, minimum, midpoint, preferred, and above-preferred limits, including the equal-minimum/preference guard; verify the targeted policy suite reports the unimplemented cases.
- [x] 2.2 Implement bounded context/output fit and the coarse weighted-average role score using only supported dimensions; verify all saturation and role-score tests pass with `cd src/admin && bun test lib/agent-model-suggestion-policy.test.ts`.
- [x] 2.3 Add failing tests for benchmark normalization with two comparable values, a missing value in a comparable cohort, and fewer than two values; implement active-weight renormalization and verify the suggestion becomes heuristic only when comparison is unavailable.

## 3. Mode Ranking and Explanations

- [x] 3.1 Add failing free-mode tests for zero-price/fresh gates followed by role score and lexical tie-breaking; update free ranking and verify the targeted policy suite passes without permitting a paid fallback.
- [x] 3.2 Add failing economy tests proving effective cost remains the first key, role score breaks equal-cost ties, unknown cost remains last, and reference is the final key; update economy ranking and verify the targeted policy suite passes.
- [x] 3.3 Add failing performance tests proving role score is the first key, saturated limits do not dominate, comparable benchmark contributes without globally overriding role fit, and reference resolves exact ties; update performance ranking and verify the targeted policy suite passes.
- [x] 3.4 Add failing reason tests for mode, role, bounded score, deciding dimensions, unknown-Agent fallback, and heuristic disclosure; update the existing bounded `reason` generation without adding response fields and verify the targeted policy suite passes.

## 4. Cross-Agent and Compatibility Regression

- [x] 4.1 Add a multi-Agent fixture where reasoning, research, exploration, coding, and multimodal roles select their own best eligible candidate; verify duplicate winners remain allowed and input permutation does not change results.
- [x] 4.2 Extend `src/admin/lib/agent-model-reconciler-modes.test.ts` to verify explicit role-aware suggestions remain probe-free, write-free, restart-free, Provider-scoped, and JSON-serializable; verify that test file passes.
- [x] 4.3 Extend route and view tests to verify the existing response shape, heuristic label, pending-edit preservation, and omitted-mode legacy behavior remain unchanged; verify `cd src/admin && bun test routes/agent-models-modes.test.ts views/agent-models.test.tsx` passes.

## 5. Verification

- [x] 5.1 Run `cd src/admin && bun test lib/agent-model-suggestion-policy.test.ts lib/agent-model-reconciler-modes.test.ts routes/agent-models-modes.test.ts views/agent-models.test.tsx` and verify all targeted tests pass.
- [x] 5.2 Run `bash test/test-agent-model-policy.sh` from the repository root and verify the shell policy regression passes.
- [x] 5.3 Run `openspec validate add-role-aware-agent-model-scoring --strict` and verify the implemented behavior remains consistent with the change specification.
