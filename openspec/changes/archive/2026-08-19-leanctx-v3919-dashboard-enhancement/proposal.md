## Why

lean-ctx v3.9.19 introduces three new CLI surfaces that expose Decision Loop metrics — task value reports, evidence chain audits, and savings breakdowns by tool — but the Admin Dashboard currently only surfaces raw token savings and memory fact counts. An admin monitoring workspace health has no visibility into whether the Decision Loop is actually accepting tasks, whether evidence chains are complete, or which tools are driving savings. Upgrading to 3.9.19 and surfacing these metrics closes that gap: the Dashboard goes from "how many tokens were saved" to "is the system making good decisions and where is the value coming from."

## What Changes

- **Version bump**: Dockerfile `LEANCTX_VERSION` 3.9.18 → 3.9.19 (the existing `savings verify` probe is backward-compatible; confirmed by running the 3.9.19 binary).
- **New probe: Value Report** — `lean-ctx value-report --live --format json` yields task-level value-gate data: total tasks assessed, acceptance rate, CPAO (cost-per-accepted-outcome) micros, ETPAO tokens, total cost, estimated USD savings, and per-task breakdowns (model, tokens, cost, acceptance, evidence strings). Adds a `ValueReportStats` interface and `probeValueReport()` function.
- **New probe: Prove Report** — `lean-ctx prove --format json` yields Decision Loop evidence chain data: acceptance rate, aggregate CPAO, evidence chain completeness, ledger metadata, and per-task evidence stages (ingress → triage → router → value_gate). Adds a `ProveReportStats` interface and `probeProveReport()` function.
- **New probe: Savings Report** — `lean-ctx savings --format json` yields a richer savings surface than the existing `gain --json`: period-scoped totals (tasks, tokens, compression %, USD), plus `top_sources` array ranking tools by tokens saved. Adds a `SavingsReportStats` interface and `probeSavingsReport()` function.
- **Dashboard panels**: Three new cards — "Decision Loop" (acceptance rate, CPAO, ETPAO), "Evidence Chain" (completeness, ledger status, task count), "Savings by Tool" (top 5 tools, compression breakdown). Existing Token Savings / leanCTX Memory / leanCTX Activity cards are unchanged.
- **API surface**: `/api/status` gains `valueReport`, `proveReport`, `savingsReport` fields. The Dashboard HTML route wires the same three new probes into `DashboardData`.

## Capabilities

### New Capabilities

- `admin-dashboard-value-metrics`: Surfaces lean-ctx Decision Loop metrics (value-report, prove-report, savings-report) through new Admin Dashboard panels, new probe functions, and extended `/api/status` fields. Covers the probe → cache → API → dashboard rendering chain for all three new CLI surfaces.

### Modified Capabilities

- `admin-project-status`: Extends the existing "Dashboard includes site-level leanCTX statistics" requirement to also surface value-gate and evidence-chain metrics alongside the current memory-fact and activity metrics. No existing requirement is removed or altered; the new metrics are additive.

## Impact

- **Probe layer** (`src/admin/lib/project-tool-status.ts`): Add three new probe functions following the existing `probeGain` pattern (command constant + parse function + TTL cache). Extend `ProjectToolStatusProvider` interface with `probeValueReport()`, `probeProveReport()`, `probeSavingsReport()`. ~80 lines of new code.
- **Status aggregation** (`src/admin/lib/status.ts`): Add `valueReport`, `proveReport`, `savingsReport` to `StatusResponse`, `StatusDeps`, and `collectStatus()` Promise.all. ~15 lines.
- **Dashboard route** (`src/admin/server.ts`): Wire three new probes in the `"/"` route handler and pass results to `DashboardPage`. ~10 lines.
- **Dashboard view** (`src/admin/views/dashboard.tsx`): Add `ValueReportStats`, `ProveReportStats`, `SavingsReportStats` to `DashboardData`. Add three new `MetricCard`/card sections. ~60 lines of TSX.
- **Tests** (`src/admin/lib/project-tool-status.test.ts`, `src/admin/lib/status.test.ts`): Add parse tests for new JSON schemas, cache behavior tests, null-on-failure tests. ~80 lines.
- **Version pin** (`Dockerfile`): `ARG LEANCTX_VERSION=3.9.18` → `3.9.19`. One line.
- **Docs** (`docs/CHANGELOG.md`, `docs/knowledge/tooling/lean-ctx-optimization.md`): Update lean-ctx version references. No behavioral doc changes.
- **Dependencies**: No new npm dependencies. The three new probes use the same `execInAiDev` + `JSON.parse` pattern as existing probes.
