# Managed OpenCode Health Timeout During Startup Reconciliation

## Context

Startup reconciliation runs after `openchamber serve` and writes model overrides in one batch. The batch restarts the managed OpenCode process and verifies its health before reporting success.

## Problem

On `192.168.11.194`, reconciliation selected replacement models but reported:

```text
managed-opencode health timeout
[agent-models] reconciled: changed=7 applied=0 failed=7
```

The configuration was then rolled back, so the UI continued to show `PLUGIN` and an empty `Configured Model` for those agents.

## Solution

`restartManagedOpenCode()` must wait longer than OpenChamber's periodic lifecycle check. The lifecycle observed the killed process only after roughly 60 seconds and started the replacement server at the same time the old 60-second health loop expired. The helper now:

- waits up to 10 seconds for the recorded PID to become signalable with `kill -0`;
- polls the newest managed pid/port file for 120 seconds;
- uses a 150-second command timeout.

The normal path still performs one kill and one managed-server restart. A failed verification remains rollback-safe.

## Why It Works

The previous 60-second health window ended before OpenChamber's 60-second periodic process check could launch the replacement server. Extending the polling window allows the helper to observe the new pid/port and authenticated `/global/health` response instead of treating the lifecycle delay as a failed restart.

## Side Effects / Tradeoffs

- A reconciliation restart can now wait up to 150 seconds before failing.
- PID files remain trusted for process identity; PID reuse is not eliminated.
- On restart or probe failure, rollback may intentionally cause a second recovery restart.

## Evidence

- 194 startup decision logs were emitted at `06:57:13`.
- `managed-opencode health timeout` occurred at `06:58:16`.
- OpenChamber logged `periodic health check: OpenCode process exited, restarting...` at `06:58:16`, immediately after the helper timed out.
- The targeted regression suite passed: `42 pass, 0 fail`.
- The deployed image containing the fix was `sha256:181005fa...`.

## Related Files

- `src/admin/lib/restart-ai-dev.ts`
- `src/admin/lib/restart-ai-dev.test.ts`
- `src/admin/lib/agent-models.ts`
- `src/admin/lib/agent-model-reconciler.ts`
- `scripts/reconcile-agent-models.sh`

## Tags

`managed-opencode` `health-timeout` `startup` `reconciliation` `rollback` `lifecycle`
