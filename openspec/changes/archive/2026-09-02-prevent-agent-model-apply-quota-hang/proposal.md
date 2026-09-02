## Why

Applying agent model changes can remain in an `Applying & restarting...` state for several minutes when a provider has exhausted its free or paid usage limit. The apply path performs real inference checks after the managed server becomes healthy, and quota responses are currently treated as retryable; this both delays feedback and can repeat billable checks. The change makes configuration apply bounded and non-billable by default while preserving an explicit path for model usability testing.

## What Changes

- Make Apply verify configuration loading and managed-server readiness without sending inference requests by default.
- Define an optional `verification` request field with `"readiness"` as the default and `"inference"` as the explicit, cost-labeled opt-in mode for both batch and single-agent Apply.
- Add a terminal quota-exceeded result for provider responses such as HTTP 429, free-usage exhaustion, and insufficient quota; do not retry or rollback a successfully applied configuration for this result.
- Add bounded server/request handling so the default Apply completes within 180 seconds and the UI cannot remain in an indefinite applying state; explicit inference verification is bounded to 300 seconds.
- Stop redundant inference checks for a provider/model after a quota-exceeded result and reuse a 900-second provider-scoped negative cache.
- Keep real model usability checks available as an explicit, user-triggered action with a clear cost warning.
- Preserve rollback for restart failures and conclusively unavailable or retired models, while reporting quota exhaustion separately from runtime mismatch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-agent-model-config`: change post-restart Apply verification to be readiness/configuration based by default, define quota-exceeded reporting, and bound the user-visible operation.
- `admin-agent-models-batch`: stop batch verification after quota exhaustion, preserve applied configuration, and return per-agent degraded results without introducing a new HTTP status contract.
- `agent-model-reconciliation`: retain real inference proof for automatic reconciliation, but apply provider-scoped quota termination, cooldown, and probe-budget rules so background reconciliation cannot repeatedly spend quota.

## Impact

- Affected backend: `src/admin/lib/agent-models.ts`, `src/admin/lib/model-probe.ts`, `src/admin/lib/agent-model-live.ts`, `src/admin/lib/agent-model-reconciler.ts`, and related result types/routes.
- Affected frontend: `src/admin/views/agent-models.tsx` Apply state, timeout, and quota messaging.
- Affected scripts and tests: model health classification/cache tests, apply/batch tests, restart tests, and the agent-model integration coverage.
- Existing clients continue receiving per-agent results through the current endpoint; quota exhaustion is represented by a new result status rather than HTTP `207`.
- The result contract distinguishes `ProbeStatus: quota_exceeded` from `ApplyResult.status: applied_with_quota_warning`.
