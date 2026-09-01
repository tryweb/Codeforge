## Context

`add-role-aware-agent-model-scoring` is uncommitted and explicitly rejected diversity („duplicate models remain valid; role differentiation may naturally produce distinct winners but does not force them“). This change supersedes that decision with a bounded exception: diversity may only choose among candidates already provably equal on every ranking dimension the system trusts. All other inputs (price, context/output limits, reasoning/toolCall, attachment, structured output, benchmark, freshness) and legacy health-probe semantics stay authoritative.

OpenSpec source of truth before this change is `specs/admin-agent-model-selection-modes/spec.md`. The change delta lives in `changes/add-bounded-diversity-agent-model-selection/specs/admin-agent-model-selection-modes/spec.md` and supersedes only the diversity boundary.

## Goals / Non-Goals

**Goals:**

- Provide deterministic, bounded variation inside exact ties without changing the winner when scores differ.
- Keep the implementation run-local (ledger dies with the call), explanation-bounded (marker inside existing `reason` only when it mattered), and probe-free for explicit suggestions.
- Give high-risk reviewers a different lens than the coding agent when the tie allows it, without demoting the better model.
- Preserve API schema, config format, probe budget, apply/verify/rollback, and deterministic ordering.
- Prove the invariants with failing-first tests and leave legacy `suggest`/`runOnce` either identically bounded (if safe) or explicitly unchanged with rationale.

**Non-Goals:**

- Weighted diversity penalty subtracted from roleScore, random tie-breaking, forced model changes, model-name inference, or hard provider exclusion.
- New API fields (`diversity`, `provider`, `scoreBreakdown`), new config keys, persistence, telemetry, or UI columns.
- Re-tuning role weights, thresholds, saturation, or benchmark normalization.
- Changing health probing semantics, `MAX_PROBES`, or reconciler rollback safety.

## Decisions

### Exact-tie definition

A tie is exact equality on the primary ranking keys, not an epsilon:

- `free`: same `roleScore`
- `economy`: same `effectiveCost` (including `Infinity` for unknown price) **and** same `roleScore`
- `performance`: same `roleScore` (benchmark, contextFit, outputFit already folded into roleScore; comparable cohort handled before ranking)

Singletons (group size 1) fall back to the existing deterministic reference ordering with no ledger effect beyond counting the winner.

Alternative considered: capped epsilon or score bucket. Rejected because it would demote a genuinely higher-scoring candidate and requires tuning.

### Run-local ledger

Inside one `suggestForMode()` call, maintain:

```ts
modelReuse: Map<string, number>      // reference → count
providerReuse: Map<string, number>   // providerId → count
codingModel: string | null           // selection for sisyphus-junior when known
```

Ledger is initialized empty, updated immediately after each agent's winner is chosen, and discarded on return. Deterministic agent iteration order is the input `agents` order (route handlers already sort); tests assert permutation does not change multiset of results beyond defined tie behavior.

No global state, no file, no env.

### Diversity ordering inside the tie group only

Original ranking (`suggestForMode` today) first sorts each agent's filtered candidates by mode keys then `compareReferences`. Diversity re-sorts **only** the tie slice:

1. For high-risk agents (`review`, `deep-reasoning`) when `codingModel` is known: candidates with `reference !== codingModel` precede those equal to it. Unknown counterpart => no reordering from this rule.
2. Lower `modelReuse` first (unused models before reused).
3. Lower `providerReuse` first.
4. `compareReferences` ascending (lexicographic stability).

Step 1 precedes steps 2–3 for high-risk agents only; for other roles step 1 is skipped. The winner is the first element of this diversity-sorted slice. Ledger then records winner.

This guarantees: never picks outside the slice; deterministic (all keys total order); no floating weights.

Alternative considered: weighted penalty `score -= λ * reuseCount`. Rejected — it would demote non-tied winners and needs tuning.

### Cross-review separation scope

High-risk set = `review` and `deep-reasoning` roles (agents `momus`, `oracle`, `metis`). Coding counterpart = `sisyphus-junior`. The preference is bounded by the same tie slice; if every tied candidate equals the coding model, the same model is re-suggested (diversity cannot invent an alternative). If the counterpart hasn't been selected yet (agent appears earlier, or not in `agents`), treat as no-op.

Alternative considered: also separating `planning`. Rejected per task scoping to `review/deep-reasoning`.

### Reason marker

Extend `reasonFor()` to append a concise marker only when diversity actually changed the winner relative to the lexicographically first element of the tie slice:

- generic diversity: ` · diversity`
- cross-review case (high-risk tie diversified away from codingModel): ` · cross-review`

Marker is appended before the `capReason(200)` truncation so reason never exceeds 200 characters; marker absent when singleton or when lexical winner already satisfied diversity ordering. This satisfies „bounded“ and „only when diversity actually decides“.

Alternative considered: new response field `diversity: true`. Rejected — task forbids API shape change.

### Legacy and fallback boundary

Explicit path (`suggestForMode`/`suggestExplicit`) is probe-free, so bounded ledger is free. Legacy `suggest()` and reconciler `runOnce` fallback are health-probe paths limited by `MAX_PROBES = 12` and rollback safety. Applying bounded diversity there would require re-probing alternative tied candidates after a health failure, which could double probe cost or change rollback ordering. Unless the tie diversification can be proven probe-budget neutral (serve from already-probed cache, no extra probes), those paths remain unchanged and the spec explicitly documents the boundary: „Legacy capability-only suggestions and automatic reconciler fallback do not apply bounded diversity; they retain deterministic capability ranking and per-candidate probing.“

This boundary is intentionally documented as a non-goal of this change.

## Risks / Trade-offs

- [Any diversity could be mistaken for a ranking change] → Restrict to exact tie; add tests proving non-tied winner unchanged and reason without marker when no tie.
- [Agent order dependence for cross-review] → Document deterministic order rule; test that high-risk after coding diversifies and before coding does not.
- [Provider/model counts could leak across requests] → Ledger is a local variable, not module global; tests assert fresh ledger per call.
- [Reason overflow] → Marker appended before truncation; test bounded length.
- [Legacy probe budget] → Keep legacy paths unchanged; spec states the boundary explicitly.

## Migration Plan

1. Add failing tests for bounded diversity in `src/admin/lib/agent-model-suggestion-policy.test.ts`.
2. Implement ledger and bounded tie-diversification in `src/admin/lib/agent-model-suggestion-policy.ts` (keep `suggestForMode` signature and `PolicyInput` unchanged; ledger is internal).
3. Verify explicit-path determinism, cross-review, and reason-marker tests pass; run `bun test` + `tsc --noEmit` + `openspec validate add-bounded-diversity-agent-model-selection --strict`.
4. Document unchanged legacy boundary in spec delta; leave reconciler `suggest`/`runOnce` untouched.
5. Role-aware change remains base; this change supersedes only its diversity decision — no history rewrite.

