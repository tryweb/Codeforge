## 1. Catalog metadata integration

- [x] 1.1 Add typed normalized model metadata for cost, context limits, capabilities, lifecycle status, freshness, source status, warnings, and heuristic state; verify complete, missing, deprecated, and malformed records with unit tests
- [x] 1.2 Implement the fixed server-side `https://models.dev/api.json` client with a 3000ms timeout and validated cache using `FREE_FRESH_TTL_MS=3600000` and `OTHER_USABLE_TTL_MS=21600000`; verify fresh, stale, expired, malformed, timeout, and unavailable-cache tests
- [x] 1.3 Join external metadata to connected OpenCode models by complete Provider/model identity and exclude unmatched, disconnected, and deprecated candidates where required; verify intersection and identity-mismatch tests

## 2. Mode-aware suggestion policy

- [x] 2.1 Validate optional `mode` and Provider scope, preserve legacy capability-only behavior when mode is omitted, and implement the explicit response schema with source status, age, warnings, metadata, reason, and heuristic fields; verify route compatibility and schema tests
- [x] 2.2 Implement free-mode filtering requiring fresh zero input/output prices, non-deprecated status, and Agent minimum capabilities; verify paid, unknown-cost, stale, deprecated, incapable, and no-candidate tests
- [x] 2.3 Implement economy ranking as effective cost (`input*0.6 + output*0.4`) ascending, capability score descending, and complete reference ascending; treat only missing/unknown context limits as context-inadequate; verify missing-price, missing-context, and tie-breaker tests
- [x] 2.4 Implement performance ranking as comparable benchmark descending when available, capability score descending, context descending, output limit descending, freshness descending, and complete reference ascending; treat only missing/unknown context limits as context-inadequate; verify deterministic ordering and `heuristic` behavior
- [x] 2.5 Keep Generate Suggestions probe-free and preserve existing Apply/restart/probe/verification/rollback behavior; verify no-write/no-restart suggestion tests and existing reconciler regressions

## 3. Admin UI integration

- [x] 3.1 Add Provider-adjacent mode selection defaulting to `free` and include the selected mode in Generate Suggestions requests; verify default, mode-change, and Provider-scope request tests
- [x] 3.2 Render recommendation metadata, ranking reasons, source age/status, warnings, heuristic labels, and no-candidate states without overwriting pending manual edits; verify UI explanation and failure-state tests
- [x] 3.3 Keep accepted suggestions in the existing pending batch Apply flow and submit only validated explicit `provider/model` values; verify accepted-suggestion, manual-selection, and apply-failure integration tests

## 4. Verification

- [x] 4.1 Run targeted route, reconciler, metadata-client, and UI tests covering all modes, legacy requests, stale/unavailable metadata, deterministic ordering, and free-mode fail-closed behavior; verify the targeted suite passes
- [x] 4.2 Run type checking, linting, and the relevant Admin Agent Models end-to-end tests; verify targeted tests and OpenSpec validation pass, document pre-existing full-suite/typecheck failures, and skip live e2e when credentialed container mutation is not authorized
