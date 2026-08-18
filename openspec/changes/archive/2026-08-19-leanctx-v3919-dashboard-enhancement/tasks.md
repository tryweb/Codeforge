## 1. Version Bump

- [x] 1.1 Update `Dockerfile` ARG `LEANCTX_VERSION` from `3.9.18` to `3.9.19` (line 16)
- [x] 1.2 Add CHANGELOG entry for lean-ctx version bump following the 3.9.17→3.9.18 pattern (around line 272)
- [x] 1.3 Update `docs/knowledge/tooling/lean-ctx-optimization.md` lean-ctx version reference

## 2. Probe Layer — Value Report

- [x] 2.1 Add `VALUE_REPORT_COMMAND = "lean-ctx value-report --live --format json 2>/dev/null"` constant in `project-tool-status.ts` (near line 193)
- [x] 2.2 Add `ValueReportStats` interface in `project-tool-status.ts`: `{ totalTasks: number; acceptedRate: number; cpaoMicros: number; etpaoTokens: number; totalCostMicros: number; savingsUsd: number; tasks: ValueReportTask[] }` with `ValueReportTask` sub-interface: `{ taskId: string; model: string; totalTokens: number; costMicros: number; outcomeAccepted: boolean; cpaoMicros: number | null; evidence: string[]; timestamp: string }`
- [x] 2.3 Add `parseValueReportStats(json: unknown): ValueReportStats | null` function in `project-tool-status.ts` with null-safe field extraction and fallback defaults
- [x] 2.4 Add `probeValueReport()` method to `ProjectToolStatusProvider` interface (line 90-95) returning `Promise<ValueReportStats | null>`
- [x] 2.5 Add `valueReportCache` object and wire `probeValueReport` in `createToolStatusProbe` return object following the `probeGain` cache pattern (around line 266-281)

## 3. Probe Layer — Prove Report

- [x] 3.1 Add `PROVE_REPORT_COMMAND = "lean-ctx prove --format json 2>/dev/null"` constant in `project-tool-status.ts`
- [x] 3.2 Add `ProveReportStats` interface: `{ acceptedRate: number; aggregateCpaoMicros: number; evidenceChainComplete: boolean; ledger: ProvenanceLedger; totalTasks: number; tasks: ProveReportTask[] }` with `ProvenanceLedger` and `ProveReportTask` sub-interfaces
- [x] 3.3 Add `parseProveReportStats(json: unknown): ProveReportStats | null` function with null-safe extraction
- [x] 3.4 Add `probeProveReport()` method to `ProjectToolStatusProvider` interface returning `Promise<ProveReportStats | null>`
- [x] 3.5 Add `proveReportCache` object and wire `probeProveReport` in `createToolStatusProbe` return object

## 4. Probe Layer — Savings Report

- [x] 4.1 Add `SAVINGS_REPORT_COMMAND = "lean-ctx savings --format json 2>/dev/null"` constant in `project-tool-status.ts`
- [x] 4.2 Add `SavingsReportStats` interface: `{ period: string; totalTasks: number; acceptedTasks: number; tokensProcessed: number; tokensSaved: number; compressionPercent: number; estimatedCostUsd: number; actualCostUsd: number; totalSavingsUsd: number; savingsPercent: number; cpaoUsd: number; etpao: number; topSources: [string, number][] }`
- [x] 4.3 Add `parseSavingsReportStats(json: unknown): SavingsReportStats | null` function with null-safe extraction
- [x] 4.4 Add `probeSavingsReport()` method to `ProjectToolStatusProvider` interface returning `Promise<SavingsReportStats | null>`
- [x] 4.5 Add `savingsReportCache` object and wire `probeSavingsReport` in `createToolStatusProbe` return object

## 5. Status Aggregation

- [x] 5.1 Add `valueReport`, `proveReport`, `savingsReport` fields to `StatusResponse` interface in `status.ts` (line 26-43)
- [x] 5.2 Add `probeValueReport`, `probeProveReport`, `probeSavingsReport` optional methods to `StatusDeps` interface in `status.ts` (line 45-53)
- [x] 5.3 Wire three new probes into `collectStatus()` Promise.all in `status.ts` (line 111-126) with null fallbacks
- [x] 5.4 Add three new fields to the return object in `collectStatus()` (line 140-164)

## 6. Dashboard Route

- [x] 6.1 In `server.ts` Dashboard route (line 157), add `probeValueReport`, `probeProveReport`, `probeSavingsReport` calls via `Promise.all` alongside existing `probeSite`/`probeGain`
- [x] 6.2 Pass `valueReport`, `proveReport`, `savingsReport` into `DashboardPage({...})` call (line 200-201)

## 7. Dashboard View

- [x] 7.1 Add `valueReport`, `proveReport`, `savingsReport` optional fields to `DashboardData` interface in `dashboard.tsx` (line 22-39)
- [x] 7.2 Add "Decision Loop" `MetricCard` in `metric-row` section (after line 141): value = totalTasks, sub = acceptance rate, foot = CPAO + ETPAO
- [x] 7.3 Add "Evidence Chain" `MetricCard` in `metric-row` section: value = totalTasks, sub = chain complete status, foot = ledger item count
- [x] 7.4 Add "Savings by Tool" `MetricCard` in `metric-row` section: value = totalSavingsUsd, sub = compression %, foot = top tool name
- [x] 7.5 Add "Decision Loop" detail card (after Token Savings card, line 230): per-task breakdown table with model, tokens, cost, acceptance, evidence columns
- [x] 7.6 Add "Evidence Chain" detail card: per-task summary table with query, intent, complexity, envelope, references, stages columns
- [x] 7.7 Add "Savings by Tool" detail card: ranked tool breakdown table with source name, tokens saved, and percentage columns
- [x] 7.8 Handle null/empty states: each new card shows "unavailable" or "No data" when its probe returns null or empty tasks array

## 8. Tests

- [x] 8.1 Add unit tests for `parseValueReportStats`: valid JSON, missing fields, empty tasks, non-JSON input → null
- [x] 8.2 Add unit tests for `parseProveReportStats`: valid JSON, missing fields, empty tasks, non-JSON input → null
- [x] 8.3 Add unit tests for `parseSavingsReportStats`: valid JSON, missing fields, empty topSources, non-JSON input → null
- [x] 8.4 Add integration test for `probeValueReport`: mock execInAiDev returning valid JSON → correct ValueReportStats
- [x] 8.5 Add integration test for `probeProveReport`: mock execInAiDev returning valid JSON → correct ProveReportStats
- [x] 8.6 Add integration test for `probeSavingsReport`: mock execInAiDev returning valid JSON → correct SavingsReportStats
- [x] 8.7 Add cache behavior tests: second call within TTL returns cached value, call after TTL re-probes
- [x] 8.8 Add null-on-failure tests: command timeout → null, non-JSON output → null, command not found → null
- [x] 8.9 Update `status.test.ts`: verify `collectStatus()` includes new fields, verify null fallback when probe dep is missing
- [x] 8.10 Run full test suite and verify all tests pass

## 9. Validation

- [x] 9.1 Run `lsp_diagnostics` on all changed files: `project-tool-status.ts`, `status.ts`, `server.ts`, `dashboard.tsx`
- [x] 9.2 Verify no TypeScript errors across the admin module
- [x] 9.3 Manual smoke test: load Dashboard page, verify existing panels unchanged, new panels show "unavailable" (expected with empty lean-ctx data)
- [x] 9.4 Verify `/api/status` response includes new fields via curl or browser
