## Purpose

Enable batched editing of multiple agent primary models in Admin UI with a single managed OpenCode restart, reducing health-check contention and aligning UI with the startup batch reconciliation.

## Requirements

### Requirement: Batch apply agent models with single restart
The system SHALL expose PUT /api/agent-models accepting `{changes: [{agent: string, entries: Array<{model: string, variant?: string}>}], verification?: "readiness" | "inference"}` where each entry follows the same validation as the single-agent endpoint (0 or 1 entry, model must be provider/model in the active catalog, variant from the allowed set). Omitted `verification` SHALL mean `"readiness"`; any other value SHALL be rejected with HTTP 400. The handler SHALL call lib.applyAndVerifyBatch(changes) exactly once, performing one snapshot, one `join(" && ")` write, one restartManagedOpenCode, and per-agent readiness/configuration verification. The default batch operation SHALL NOT call the pre-apply model probe, successful-request verification, post-restart model probe, or any other billable model request, including `POST /session/*/message`. `verification: "inference"` SHALL be the only batch mode that sends real model requests and SHALL require an explicit user action with a quota warning. It SHALL return `{results: Record<agent, ApplyResult>}` with per-agent status, including `applied_with_quota_warning` when an explicitly requested verification encounters a terminal provider quota error.

#### Scenario: Batch with three agents succeeds with one restart
- **WHEN** an admin submits changes for explore, librarian and metis each with one valid catalog model
- **THEN** the system writes all three to ~/.omo/omo.jsonc in one shell invocation, restarts managed OpenCode once, verifies live readiness/configuration for each, and returns successful results without inference requests

#### Scenario: Batch rejects invalid catalog model without writing
- **WHEN** a batch contains a model not in the active catalog
- **THEN** the system rejects the entire batch with 400 and does not modify ~/.omo/omo.jsonc

#### Scenario: Batch with empty changes is no-op
- **WHEN** an admin submits an empty changes array
- **THEN** the system performs no snapshot, write, or restart and returns an empty results map
### Requirement: Batch endpoint reuses existing rollback semantics
The batch write SHALL preserve the existing rollback contract: write_failed restores the snapshot, restart_failed restores the snapshot, an explicitly requested probe that reports unavailable or retired restores the snapshot and re-restarts, retryable or unreachable keeps the applied configuration as unverified, quota-exhausted verification keeps the applied configuration with an applied-with-quota-warning result, and runtime_mismatch is reported without rollback. A quota-exhausted result SHALL stop additional inference probes for the affected provider/model in the same batch. The endpoint SHALL continue returning per-agent results through its existing response shape and SHALL NOT require HTTP 207.

#### Scenario: Restart failure rolls back entire batch
- **WHEN** the batch write succeeds but restartManagedOpenCode fails
- **THEN** the system restores the snapshot, and every agent in the batch reports restart_failed

#### Scenario: Probe conclusive failure rolls back entire batch
- **WHEN** any explicitly requested post-restart probe reports unavailable or retired
- **THEN** the system restores the snapshot, restarts managed OpenCode, and every agent reports the applicable rollback result

#### Scenario: Quota failure keeps entire batch applied
- **WHEN** an explicitly requested probe reports a terminal provider quota error for one agent
- **THEN** the system keeps the written configuration, does not retry equivalent probes for that provider/model, and returns an applied-with-quota-warning result without rolling back unrelated successful changes