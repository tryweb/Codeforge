## Context

Lean Context configuration has several sources and a daemon lifecycle. Reliability must be assessed without silently changing user settings or restarting services. CodeGraph and native tools remain authoritative for code and tool behavior; memory and knowledge stores are exempt from this comparison.

## Goals And Non-Goals

Goals:

- Make compression explicitly off through a controlled, one-time migration.
- Report behavioral drift without changing configuration or automatically applying or restarting it.
- Gate automatic Read, Search, and Shell routing on reproducible evidence.

Non-goals:

- Enabling shell writes, weakening the path jail, upgrading Lean Context, or treating integration depth as a benefit.
- Changing product code or runtime files in this change.

## Approach

1. Read baseline, global, project, and daemon state without mutation. Record malformed input and unavailable daemon conditions as reportable results.
2. If and only if the versioned migration marker is absent and the effective compression value is `lite`, `standard`, or `max`, create a versioned backup, set compression explicitly to `off`, preserve unrelated values, and leave application and restart to an administrator.
3. Compare baseline, global, project, daemon, and all long-lived container behavior in report-only mode. Use CodeGraph and native behavior as authoritative. Exclude memory and knowledge behavior from the benefit calculation.
4. Run exactly 20 scenarios under each of two fixed profiles. Independently measure incidents and net benefit. Retain automation only at zero incidents and at least 20% independently measured net benefit.
5. On any failed gate or missing required metrics, disable automatic Read, Search, and Shell routing. Keep MCP, Admin, and persistence available.

## Failure Handling

Malformed configuration, project overrides, daemon unavailability, non-automated apply or restart, missing metrics, and failed gates are surfaced in the report. No automatic recovery action changes configuration or lifecycle state.

## Verification

The change is validated with `openspec validate lean-ctx-reliability-gate --strict` and inspected through `openspec show lean-ctx-reliability-gate --json`.
