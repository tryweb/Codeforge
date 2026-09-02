## 1. Quota classification and result contracts

- [x] 1.1 Extend the probe/result types with `ProbeStatus: quota_exceeded` and `ApplyResult.status: applied_with_quota_warning` (`ok: true` with the existing resolved/request metadata and a non-secret warning), preserving existing success, mismatch, unavailable, retired, retryable, and unreachable semantics; verify TypeScript compilation and existing agent-model type tests pass
- [x] 1.2 Update provider response classification with the exact terminal markers `FreeUsageLimitError`, `free usage exceeded`, `insufficient_quota`, `credit_balance_exhausted`, `credit exhausted`, `spend_limit_exceeded`, and `quota_exceeded`; keep an unmarked 429 retryable with at most one `Retry-After`-bounded retry and unknown responses unverified; verify unit tests cover each marker in JSON/text, plain transient 429, and unknown responses
- [x] 1.3 Store quota results in the existing provider/model/fingerprint-scoped health cache for exactly 900 seconds and invalidate affected entries after successful credential mutation without exposing credentials; verify cache tests prove quota hits suppress a second probe and credential changes invalidate the entry

## 2. Non-billable Apply and batch behavior

- [x] 2.1 Add optional `verification: "readiness" | "inference"` to both Apply request bodies, default it to `"readiness"`, reject other values with HTTP 400, and change route validation so readiness Apply performs catalog/connected-provider checks without a pre-apply inference probe; verify route tests prove the default request issues no model-message command
- [x] 2.2 Update batch apply verification to use managed health, live agent, and provider state by default, while retaining the existing real temporary-session verification only for explicit `verification: "inference"`; verify batch tests cover one restart, per-agent readiness results, zero `POST /session/*/message` calls in default mode, and explicit inference invocation
- [x] 2.3 Apply quota fail-open semantics in the batch orchestrator: keep written configuration, stop equivalent inference probes for the affected provider/model, return per-agent applied-with-quota-warning results, and retain rollback only for restart or explicit conclusive unavailable/retired failures; verify agent-model tests cover quota, rollback, mismatch, and partial batch outcomes
- [x] 2.4 Keep automatic reconciliation inference proof and bounded probe selection, but stop equivalent probes after a terminal quota result and honor the provider-scoped cooldown; verify reconciler tests cover quota short-circuiting and preservation of the current assignment

## 3. Frontend bounded feedback

- [x] 3.1 Add a 180-second backend readiness bound and 300-second inference bound, use frontend deadlines of 190 and 310 seconds respectively, prevent duplicate Apply submission while active, and convert timeout/abort into an actionable terminal UI state; verify component or route tests show the applying indicator ends after the selected deadline
- [x] 3.2 Render applied-with-quota-warning distinctly from runtime mismatch, restart failure, and probe failure, including a provider/action message and an explicit cost warning for opt-in inference verification; verify UI tests cover quota, timeout, success, and rollback messages

## 4. Script and integration alignment

- [x] 4.1 Align `scripts/agent-model-health.sh` with the terminal quota marker allowlist, 900-second cooldown, bounded transient retry behavior, and existing provider-scoped cache invalidation without exposing credentials; verify shell tests cover quota, transient rate limit, unavailable, and retired responses
- [x] 4.2 Update credential-gated end-to-end coverage so normal Apply validates readiness without live inference and explicit usability verification remains the only real model request; verify the E2E test skips cleanly without the server password and restores the byte-identical configuration

## 5. Verification and rollout checks

- [x] 5.1 Run the affected Admin test suite from `src/admin` with `bun test` and verify all model configuration, batch, probe, reconciler, route, and restart tests pass
- [x] 5.2 Validate the completed OpenSpec change with `openspec validate "prevent-agent-model-apply-quota-hang" --type change --strict` and verify all proposal, spec, design, and task artifacts are accepted
- [x] 5.3 Perform a non-billable smoke test against the Admin Apply flow and verify the normal path reaches a terminal result without any `/session/.../message` inference request
