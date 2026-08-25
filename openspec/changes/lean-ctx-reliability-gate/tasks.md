## 1. OpenSpec reliability contract

- [x] 1.1 Create the proposal, design, tasks, and `leanctx-admin-config` delta spec for the explicit lossless default, one-time migration, report-only drift, authority boundary, evaluation gate, and fail-safe rollback. Verify with `openspec validate lean-ctx-reliability-gate --strict` and `openspec show lean-ctx-reliability-gate --json`; evidence: `.omo/evidence/` task-1 record.

## 2. Lossless defaults and migration

- [x] 2.1 Set both known defaults to explicit `compression_level = "off"` and implement the versioned, backed-up, idempotent migration for existing `lite`, `standard`, or `max` values while preserving explicit `off`, unrelated settings, and malformed-file recovery. Verify schema/unit and Docker startup cases for new, lossy, explicit-off, malformed, and repeat-startup configurations; evidence: `.omo/evidence/` task-2 run at 14:00.

## 3. Typed report-only drift model

- [x] 3.1 Implement typed baseline, global, project, daemon, and behavioral sentinel drift statuses with injected command and file-read dependencies, bounded execution, and no apply or restart behavior. Verify healthy, malformed, lossy, project-override, daemon-unavailable, timeout, marker, appended-content, byte-mismatch, and exact-match cases; evidence: `.omo/evidence/` task-3 record.

## 4. Admin drift API and UI

- [x] 4.1 Add `GET /api/leanctx/drift` and the persistent accessible, status-specific warning in the existing lean-ctx editor without changing Save to Apply behavior or performing writes. Verify route healthy, indeterminate, and detector-failure cases, Playwright injected-drift and recovery behavior, and visual QA at desktop and mobile widths; implementation and final visual PASS evidence complete.

## 5. Authority guidance

- [x] 5.1 Update repository and generated guidance, tooling documentation, knowledge documentation, and startup assertions so CodeGraph/native tools are authoritative for source operations, diagnostics, tests, git, and writes while lean-ctx memory and knowledge remain available. Verify generated and repository guidance are content-equivalent and contain no obsolete mandatory-routing claims.

## 6. Live gates and evaluation harness

- [x] 6.1 Add deterministic G0 to G4 live checks and an isolated harness with exactly 20 fixed scenarios under two profiles, schema-validated independent metrics, incident records, and a machine verdict that retains only at zero incidents and at least 20 percent net benefit. Verify partial or duplicate manifests, missing metrics, threshold boundaries, incidents, timeouts, non-zero exits, appended content, and a perfect pass.

## 7. Isolated evaluation campaign

- [x] 7.1 Run G0 across every long-lived container, then execute both isolated profiles and record exactly 40 comparable scenario records, metadata, hashes, incidents, and evaluator version in the evidence directory with an immutable maintenance summary. Verify required metadata and hashes, deterministic byte-identical reruns, and a synthetic incident flip to `disable-routing`. G0 failed on the released v1.15.6 fleet, so the mandatory stop path superseded campaign execution and classified the result as `disable-routing`.

## 8. Verdict and operational documentation

- [x] 8.1 Consume the machine verdict without override, apply the retain or disable-routing documentation and routing state, and document rollback, re-enable, migration, drift, explicit Apply, and persistence boundaries. Verify disposable rollback and re-enable, Admin health, drift API, MCP memory and knowledge availability, generated guidance, strict validation, and no production-volume deletion; evidence: `.omo/evidence/lean-ctx-reliability-gate/task-8/`.

## Final verification gates

- [x] F1. Run formatter, linter, type, focused test, route/view test, and strict OpenSpec validation checks; require zero new diagnostics.
- [x] F2. Build and start isolated Docker Compose services, resolve connectivity using localhost then bridge-gateway fallback, run `test/run-tests.sh` and the reliability harness, and require G0 through G4 to pass.
- [x] F3. Run Playwright user-surface QA for healthy, project-drift, daemon-down, and recovered Admin states at desktop and mobile widths; archive snapshots and console/network results under `.omo/evidence/lean-ctx-reliability-gate/`.
- [x] F4. Audit safety and reversibility for shell writes, path-jail weakening, auto-apply or restart, unpinned upgrades, secret-bearing logs, and production-volume deletion; rehearse rollback in isolated volumes.
- [x] F5. Recompute the decision from all 40 evidence records, require byte-identical verdict output, and verify repository routing and documentation match that verdict. All five gates must approve before completion. The fleet G0 mandatory-stop path superseded campaign execution, so final verification used the sealed G0 classification plus two byte-identical 40-record synthetic selfchecks and did not fabricate campaign records.
