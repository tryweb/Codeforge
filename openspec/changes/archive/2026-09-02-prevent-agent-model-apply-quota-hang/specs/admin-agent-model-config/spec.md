## MODIFIED Requirements

### Requirement: Apply confirmation and runtime reporting after restart
Both `PUT /api/agent-models` and `PUT /api/agent-models/:agent` SHALL accept an optional body field `verification` whose value is `"readiness"` or `"inference"`; omitted `verification` SHALL mean `"readiness"`, and any other value SHALL be rejected with HTTP 400. After an atomic write, the system SHALL restart only managed OpenCode and SHALL leave the `ai-dev` container running. It SHALL confirm that the replacement managed server is reachable and that the configured primary is loaded by the live `/agent` and provider state. The default Apply operation SHALL NOT call the pre-apply model probe, successful-request verification, post-restart model probe, or any other billable model request, including `POST /session/*/message`. Real model usability verification SHALL be available only when `verification` is `"inference"` through an explicit user-triggered action that clearly warns it may consume provider quota. A readiness Apply SHALL have a hard overall limit of 180 seconds; an inference verification SHALL have a hard overall limit of 300 seconds. The system SHALL restore the previous configuration and attempt to restore the previous managed runtime when the managed restart fails or an explicitly requested post-restart probe conclusively reports `unavailable` or `retired`. A runtime model mismatch SHALL be reported without rollback. A quota-exhausted result SHALL be represented by `ProbeStatus: quota_exceeded` during probing and by an `ApplyResult` with `ok: true`, `status: "applied_with_quota_warning"`, existing resolved/request metadata, and a non-secret warning after a successful write/restart. It SHALL not be retried automatically and SHALL not trigger rollback. An HTTP 429 without a recognized quota marker SHALL remain a transient retryable result rather than a quota result.

#### Scenario: Apply confirms configuration without inference
- **WHEN** the atomic write and managed restart succeed and the replacement server reports the configured model through readiness and live configuration endpoints
- **THEN** the system reports the apply as successful without sending a temporary-session inference request, and the `ai-dev` container remains running

#### Scenario: Apply is effective after restart
- **WHEN** the atomic write and managed restart succeed and readiness/configuration metadata confirms the configured provider and model
- **THEN** the system reports the apply as successful and the `ai-dev` container remains running

#### Scenario: Explicit usability verification succeeds
- **WHEN** an admin explicitly requests model usability verification and the temporary-session inference response metadata matches the configured provider and model
- **THEN** the system reports the model as verified and identifies that the verification may consume provider quota

#### Scenario: Apply persists but runtime differs
- **WHEN** the top-level model remains present after restart but live model metadata reports another model
- **THEN** the system reports both models as `runtime_mismatch` and does not roll back the persisted value

#### Scenario: Restart failure restores snapshot
- **WHEN** the atomic write succeeds but the managed restart fails
- **THEN** the system restores the previous `~/.omo/omo.jsonc`, attempts to restart managed OpenCode with that configuration, and reports `restart_failed`

#### Scenario: Conclusive unavailable probe restores snapshot
- **WHEN** an explicitly requested post-restart probe reports `unavailable` or `retired`
- **THEN** the system restores the previous `~/.omo/omo.jsonc`, restarts managed OpenCode with that configuration, and reports `probe_failed`

#### Scenario: Inconclusive probe keeps applied configuration
- **WHEN** an explicitly requested probe reports `retryable` or `unreachable`
- **THEN** the system keeps the applied configuration and reports `unverified` without rollback

#### Scenario: Provider quota is exhausted
- **WHEN** the provider reports free-usage exhaustion, insufficient quota, or an equivalent terminal billing limit during an explicit verification
- **THEN** the system keeps the applied configuration, stops further automatic verification for that provider/model, and reports `applied_with_quota_warning` without rollback

#### Scenario: Verification request reaches its bound
- **WHEN** readiness Apply exceeds 180 seconds or inference verification exceeds 300 seconds
- **THEN** the backend stops waiting, the frontend uses a 190-second readiness deadline or 310-second inference deadline, reports an actionable timeout state, and SHALL NOT leave the UI in an indefinite applying state

#### Scenario: Rollback recovery failure is surfaced
- **WHEN** the system cannot restore the snapshot or cannot recover managed OpenCode after a rollback-triggering failure
- **THEN** the system reports `rollback_failed` and does not claim the new configuration is effective
