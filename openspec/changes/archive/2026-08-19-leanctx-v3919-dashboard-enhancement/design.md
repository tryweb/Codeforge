## Context

The Admin Dashboard currently surfaces lean-ctx data through two probe functions in `project-tool-status.ts`: `probeLeanCtxSite()` (shell scan of `~/.local/share/lean-ctx/` for memory facts, agent activity, health coverage) and `probeGain()` (`lean-ctx gain --json` + `lean-ctx savings verify` for token savings and ledger verification). These feed `LeanCtxSiteStats` and `GainStats` interfaces, consumed by both the HTML Dashboard route (`server.ts`) and the JSON `/api/status` endpoint (`status.ts`).

lean-ctx v3.9.19 adds three new CLI surfaces with JSON output: `value-report --live --format json` (task value-gate data), `prove --format json` (Decision Loop evidence chain data), and `savings --format json` (period-scoped savings with tool breakdown). All three follow the same pattern as the existing `gain --json`: run a command, parse JSON, extract fields. The existing `savings verify` subcommand remains backward-compatible in 3.9.19 (verified by running the binary).

The probe infrastructure supports adding new probes without architectural changes: each probe is a standalone function with its own command constant, parse function, and TTL cache object, wired into the `ProjectToolStatusProvider` interface.

## Goals / Non-Goals

**Goals:**
- Add three new probe functions following the established `probeGain` pattern (command constant → parse → cache)
- Surface three new Dashboard panels: Decision Loop, Evidence Chain, Savings by Tool
- Extend `/api/status` with `valueReport`, `proveReport`, `savingsReport` fields
- Bump Dockerfile lean-ctx pin from 3.9.18 to 3.9.19
- Maintain backward compatibility: existing panels, probes, and API fields unchanged

**Non-Goals:**
- Modifying the existing `GainStats` or `LeanCtxSiteStats` interfaces (additive only)
- Adding `checkpoints`, `import`, or `health --watch` probes (none emit JSON)
- Changing the Dashboard layout or navigation structure (new cards appended to existing grid)
- Implementing real-time WebSocket updates for the new panels (poll-based via existing page load)
- Adding new npm dependencies

## Decisions

### Decision 1: Three separate probe functions vs. one combined probe

**Chosen**: Three separate probe functions (`probeValueReport`, `probeProveReport`, `probeSavingsReport`), each with its own cache and timeout.

**Rationale**: Matches the existing pattern (`probeLeanCtxSite` + `probeGain` are separate). Each CLI command is independent — a failure in one should not block the others. Separate caches allow different TTL tuning per metric (though all start at 300s). A combined probe would create a single point of failure where one slow command blocks all three panels.

**Alternatives considered**:
- Single `probeValueMetrics()` running all three commands in `Promise.all` — rejected because a timeout in one command would need partial-success handling, adding complexity for no gain.
- Extending `probeGain()` to also run the new commands — rejected because it mixes concerns (token savings vs. value-gate metrics) and would make the already-complex `parseGainStats` function harder to maintain.

### Decision 2: New interfaces vs. extending GainStats

**Chosen**: Three new standalone interfaces: `ValueReportStats`, `ProveReportStats`, `SavingsReportStats`.

**Rationale**: The three CLI surfaces have distinct schemas with no field overlap. Extending `GainStats` would create a god-interface mixing token savings, value-gate assessments, evidence chains, and tool breakdowns. Standalone interfaces keep each panel's data contract focused and testable. The `DashboardData` type simply gains three optional fields, same as the existing `leanctx` and `gain`.

**Alternatives considered**:
- Single `ValueMetricsStats` union type — rejected because the three surfaces have different refresh characteristics and failure modes; a union would obscure which probe failed.
- Extending `GainStats` with optional fields — rejected because it violates the interface's existing single responsibility (token savings telemetry).

### Decision 3: Probe function placement

**Chosen**: Add the three new probe functions in `project-tool-status.ts` alongside the existing `probeLeanCtxSite` and `probeGain`, following the same pattern (command constant at module level, parse function, cache object, wired into `createToolStatusProbe` return value).

**Rationale**: All lean-ctx probes share the same infrastructure: `execInAiDev` transport, TTL cache, semaphore-controlled concurrency. Keeping them in one file maintains discoverability — a developer looking for "what does the admin probe from lean-ctx" finds everything in one place. The file is currently 313 lines; adding ~80 lines keeps it well under the 250-line "consider splitting" threshold only if we ignore the existing overage, but the probe functions are cohesive and splitting would scatter related logic.

**Alternatives considered**:
- New file `project-value-status.ts` — rejected because it fragments the probe layer and forces developers to search two files for lean-ctx probe logic.
- Extending `status.ts` with inline probes — rejected because `status.ts` is a thin aggregation layer; probes belong in `project-tool-status.ts`.

### Decision 4: CLI command selection for each probe

**Chosen**:
- `probeValueReport`: `lean-ctx value-report --live --format json` (the `--live` flag is required for JSON output when no persisted data exists)
- `probeProveReport`: `lean-ctx prove --format json`
- `probeSavingsReport`: `lean-ctx savings --format json`

**Rationale**: All three commands were verified to emit valid JSON by running the 3.9.19 binary. `value-report` requires `--live` to get JSON output (without it, plain text is returned even with `--format json` when data is empty). `prove` and `savings` emit JSON with just `--format json`. The existing `savings verify` subcommand is left untouched — it remains the source for `GainStats.ledgerVerified`.

**Alternatives considered**:
- Using `gain --json` for savings data instead of `savings --format json` — rejected because `gain --json` lacks the period-scoped and tool-breakdown fields that `savings --format json` provides.
- Adding `checkpoints` or `import` probes — rejected because neither emits JSON output; they would require fragile text parsing.

### Decision 5: Error handling pattern

**Chosen**: Each probe wraps its command in a try/catch that returns `null` on any failure (timeout, non-JSON output, missing command). The Dashboard renders "unavailable" for null fields. No error propagation, no retry logic.

**Rationale**: Matches the existing pattern exactly (`probeLeanCtxSite` returns `null` on failure, `probeGain` returns `null`). The Dashboard already handles null gracefully. Adding retry logic would increase probe latency and complexity for marginal benefit — the 300s cache means a failed probe is retried on the next page load anyway.

**Alternatives considered**:
- Retry with exponential backoff — rejected because probes run on page load, not in a background loop; retrying would block the page render.
- Circuit breaker pattern — rejected because the 300s TTL cache already serves as a natural deduplication mechanism.

## Risks / Trade-offs

**[Risk] lean-ctx 3.9.19 CLI output format may change in a patch release** → Mitigation: Each parse function extracts only the fields needed for its interface; unknown fields are ignored. If a field is missing, the parse returns null/defaults. The 300s cache limits blast radius — a broken parse affects at most one cache period.

**[Risk] `value-report --live` may be slow on large workspaces** → Mitigation: The 10-second probe timeout catches this. The probe runs in parallel with other probes via `Promise.all`, so it does not block page render. If it consistently times out, the panel simply shows "unavailable."

**[Risk] Three additional CLI commands per page load increase ai-dev container load** → Mitigation: Each command is lightweight (JSON output, no file I/O beyond reading stats files). The 300s cache means at most 3 additional commands every 5 minutes, which is negligible compared to the existing `gain --json` + `savings verify` + site scan that already run.

**[Trade-off] Separate probes vs. combined probe** → We chose separate probes for failure isolation and cache independence, at the cost of 3 separate cache objects and 3 separate `Promise.all` entries in the status collector. This is the correct trade-off for a monitoring dashboard where partial availability is better than all-or-nothing.

**[Trade-off] New interfaces vs. extending GainStats** → We chose new interfaces for single-responsibility, at the cost of 3 new type definitions and 3 new optional fields in `DashboardData`. This keeps each panel's data contract focused and testable.

## Migration Plan

1. Bump `LEANCTX_VERSION` in Dockerfile from 3.9.18 to 3.9.19
2. Rebuild the ai-dev image: `docker compose build ai-dev`
3. Restart the container: `docker compose up -d ai-dev`
4. Verify existing probes still work: Dashboard should show unchanged Token Savings / leanCTX Memory / leanCTX Activity panels
5. Verify new probes: Dashboard should show Decision Loop, Evidence Chain, Savings by Tool panels (or "unavailable" if lean-ctx 3.9.19 data is empty)
6. Verify `/api/status` includes `valueReport`, `proveReport`, `savingsReport` fields
7. Rollback: revert Dockerfile ARG, rebuild, restart — no data migration needed (probes are stateless reads)
