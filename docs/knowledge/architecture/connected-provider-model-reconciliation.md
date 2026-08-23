# Connected-Provider Model Reconciliation

## Context

Agent model reconciliation runs during the ai-dev container startup sequence after `openchamber serve` starts the managed OpenCode server. The reconciler must choose models that the current environment can actually serve, while still assigning different capabilities to reasoning, exploration, and general agents.

## Problem

OpenCode `/provider` exposes a complete `.all` catalog, including providers that are not connected. Treating every catalog entry as usable caused `openai/*` models to be written on hosts where only `opencode` was connected. The `/agent` endpoint reporting a model is not proof that its provider credentials are configured or that a request will succeed.

Provider discovery also has a startup race: `openchamber serve` can return before `/provider` has usable connected models. A readiness check that only tests HTTP health is insufficient.

## Solution

- `catalog_from_provider_json()` intersects `.all` with `.connected`; only those models are candidates.
- `wait_for_provider()` polls the managed server and requires a non-empty connected-provider response before selection.
- Candidate selection uses model capability metadata (`reasoning`, `toolcall`, `attachment`, and input capabilities), not hardcoded model IDs.
- Agent names map to capability classes: reasoning, exploration, and general.
- After rewriting `omo.jsonc` and native `opencode.json`, the managed server is restarted and `/provider` readiness is checked again before runtime verification.
- OMO and native config snapshots are restored if either write path fails.
- Provider key handling distinguishes adding the first key from adding an additional key: the first key is applied and restarted; additional inactive keys are only stored until selected or applied.

## Why It Works

The connected intersection prevents metadata-only providers from entering the candidate set. Capability scoring lets the same policy adapt to different providers and model inventories. Readiness checks ensure model discovery happens after the managed server is serving provider data, and post-restart verification catches provider/catalog changes during restart.

## Side Effects / Tradeoffs

- Adding a second provider API key does not change Agent Models until that key becomes active or a restart/reconciliation is triggered.
- If capability metadata is absent, selection falls back deterministically to the connected catalog order.
- Reconciliation can change legacy assignments during startup; explicit per-agent settings that are not stale policy defaults are retained unless the selected connected target differs.

## Evidence

- On `192.168.11.195`, `/provider` reported `connected: ["opencode"]`; runtime assignments after deployment used only `providerID: "opencode"`.
- Runtime health was `{"healthy":true,"version":"1.18.21"}`.
- The deployed container remained `running` with `restart_count=0` across a 10-second observation.
- Local `test/test-agent-model-reconcile.sh` and `test/test-agent-model-policy.sh` passed.

## Related Files

- `scripts/reconcile-agent-models.sh`
- `test/test-agent-model-reconcile.sh`
- `test/test-agent-model-policy.sh`
- `src/admin/lib/opencode-auth.ts`
- `src/admin/agent/commands.ts`
- `docs/knowledge/patterns/native-agent-model-override-bridge.md`

## Tags

`provider` `opencode` `agent-models` `reconciliation` `readiness` `connected-catalog` `api-key`
