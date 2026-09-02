## Context

See `proposal.md` for the motivation and user-visible scope. The current Apply path performs catalog validation, a pre-apply model probe, managed OpenCode restart, live model reads, successful-request verification, and a post-restart model probe. The latter requests use a temporary session and can consume provider quota. Provider quota responses are currently classified as retryable, while the browser waits on a fetch with no client-side deadline. Existing provider-scoped probe caching, batch application, managed health polling, and per-agent result reporting should be reused.

## Goals / Non-Goals

**Goals:**

- Make the normal Apply path bounded and non-billable while still proving that the managed server loaded the requested configuration.
- Distinguish terminal provider quota exhaustion from transient rate limiting, model unavailability, retired models, and runtime mismatch.
- Preserve configuration on quota exhaustion and keep rollback only for restart failure or conclusive unavailability/retirement during an explicitly requested inference verification.
- Prevent repeated equivalent checks within a batch, reconciliation run, and quota cooldown window.
- Preserve the existing per-agent API response shape and make the UI expose a terminal, actionable result.

**Non-Goals:**

- Changing OpenCode provider quotas, subscription behavior, or upstream retry implementation.
- Proving that a model can generate a response during every Apply operation.
- Replacing the existing health cache or redesigning model suggestion policy.
- Introducing an asynchronous operation registry or a new HTTP `207` response contract in this change.

## Decisions

### Apply uses readiness verification by default

The Apply request will use a readiness/configuration verification mode by default. The route will validate the active catalog and connected provider state, write the configuration once, restart managed OpenCode once, and verify `/global/health`, `/agent`, and `/provider` state. It will not call the pre-apply `probeModel`, `fetchSuccessfulRequestModel`, or post-restart inference probe in this mode. An explicit verification mode will opt into the existing real temporary-session check and will show a cost warning in the UI.

This is preferred over merely removing the final probe because the current route-level pre-check can already issue an inference request, and successful-request verification can also create a message request. Keeping any one of those calls would leave Apply capable of consuming quota.

### Quota failures are terminal but fail open

Probe classification will recognize provider-specific quota/billing markers, including free-usage exhaustion, `FreeUsageLimitError`, insufficient quota, credit exhaustion, and spend limits. A plain transient rate-limit response remains distinct: it may honor `Retry-After` with at most the existing bounded retry policy. A terminal quota result becomes `quota_exceeded`, is not automatically retried, does not trigger rollback, and is surfaced as `applied_with_quota_warning` after the configuration has been applied.

This avoids treating every HTTP 429 as permanent while preventing known billing failures from entering the retry path.

### Reuse per-provider negative caching and batch short-circuiting

The existing fingerprint-scoped health cache will store terminal quota results for a short cooldown, initially 15 minutes. The cache key remains scoped to provider, model, and provider credential fingerprint; credentials and fingerprints remain absent from logs and API responses. A quota result for a provider/model stops equivalent inference probes for the remainder of the current batch or reconciliation run. Normal Apply readiness checks do not consult or populate billable probe results.

### Keep rollback semantics narrow

A failed managed restart still restores the snapshot and attempts runtime recovery. An explicitly requested inference verification that conclusively reports unavailable or retired still uses the existing rollback path. Quota exhaustion, transient/unreachable results, and runtime mismatch preserve the newly written configuration and return a non-success verification state. This prevents a provider billing problem from undoing a valid user configuration.

### Bound the existing synchronous operation

The backend continues to use the existing synchronous endpoint, but all managed restart and verification calls retain explicit execution limits. The frontend Apply request gets an `AbortSignal` deadline no shorter than the backend's documented maximum, disables duplicate submission, and converts timeout/abort into an actionable terminal message. The client deadline must not expire while the backend can still be legitimately completing the restart; an asynchronous operation registry is intentionally deferred.

### Test without live provider inference

Unit and route tests will inject execution results for health, live configuration, quota, and probe paths. Existing end-to-end coverage will retain its real-inference test only for explicit usability verification and will skip when credentials are unavailable. CI must not use a real free-tier model merely to test Apply readiness or quota classification.

### Result contract

`ProbeStatus` gains `quota_exceeded`. `ApplyResult` gains an `ok: true` result with `status: "applied_with_quota_warning"`, the resolved/request-verified fields used by successful results where available, and a non-secret warning message. This status means the configuration write and managed restart succeeded; it is not a runtime mismatch, rollback failure, or proof of model usability.

## Risks / Trade-offs

- [Risk] Readiness and `/agent` state can confirm configuration loading but cannot prove that the model can generate a response. → Mitigation: keep an explicit, cost-labeled usability verification action.
- [Risk] A provider may encode quota errors differently across versions. → Mitigation: classify stable error codes and narrowly scoped message markers, retain unknown responses as unverified, and add fixtures for representative JSON/text bodies.
- [Risk] A client timeout can occur while the synchronous backend is still restarting. → Mitigation: align the client deadline with the backend bound, disable duplicate Apply while the client believes an operation is active, and defer asynchronous operation tracking rather than pretending the request was cancelled.
- [Risk] A 15-minute quota cooldown can delay recognition after a user upgrades or changes credentials. → Mitigation: scope the cache by provider credential fingerprint and eagerly invalidate it after provider credential mutation.
- [Risk] Per-agent results can differ within one batch. → Mitigation: preserve the existing result map and explicitly render applied, warning, mismatch, and rollback states per agent; do not introduce a new transport status unless the existing contract proves insufficient.

## Migration Plan

1. Add the quota result classification and cache behavior with unit tests; this is backward-compatible for existing successful, unavailable, retired, and transient results.
2. Change the default Apply path and batch verification to readiness-only, update result types/messages, and add route/backend tests proving no inference command is issued.
3. Add the explicit inference verification control and frontend timeout/cost warning, then run the existing non-live test suite and the credential-gated E2E test.
4. Deploy with the existing configuration format; no persisted migration is required. If problems arise, revert the readiness-mode and UI changes while retaining quota classification only if its result mapping remains compatible.
