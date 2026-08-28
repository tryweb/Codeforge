# Native Agent Bridge Reconcile Race (OMO → opencode.json Stale After Startup Reconcile)

## Context

`ai-dev` startup has two phases that must agree on native agent models (`general`, `plan`):

* `ENTRYPOINT` → `entrypoint.d/02-init-config.sh` regenerates `~/.config/opencode/opencode.json` from env defaults, initializes `~/.omo/omo.jsonc` via `initialize_omo_permissions`, normalizes it, then calls `merge_native_agent_overrides` to copy `omo.agents.<name>.model` → `opencode.json:agent.<name>.model`.
* `CMD` → `openchamber serve && /opt/ai-engkit/scripts/reconcile-agent-models.sh && exec openchamber logs` waits for `managed-opencode` lifecycle/health and runs `RECONCILE_STARTUP_NO_RESTART=1 bun run /opt/admin/lib/agent-model-reconcile-cli.ts`, which may write a new `agents.general.model` (e.g. `opencode/mimo-v2.5-free` when only `opencode` provider is connected) without restarting.

`test/run-tests.sh:633` asserts file equality:

```
OMO_GENERAL_MODEL=$(jq -r '.agents.general.model // empty' ~/.omo/omo.jsonc)
OPCODE_GENERAL_MODEL=$(jq -r '.agent.general.model // empty' ~/.config/opencode/opencode.json)
assert_eq "general native model matches persisted OMO override" "$OMO_GENERAL_MODEL" "$OPCODE_GENERAL_MODEL"
```

Admin `PUT /api/agent-models` uses the same `src/admin/lib/agent-models.ts:applyAndVerifyBatch` (snapshot → jq write → restart → verify → rollback) and previously did not touch `opencode.json`.

## Problem

* `0824697 fix(entrypoint): preserve native OMO overrides after setup` moved `merge_native_agent_overrides` after `lean-ctx setup/init` to avoid `lean-ctx init --agent opencode` clobbering `opencode.json`. It fixed the **generation order** race but not the **post-generation reconciliation** race.
* Startup reconcile runs **after** the ENTRYPOINT bridge. With `RECONCILE_STARTUP_NO_RESTART=1` it writes `~/.omo/omo.jsonc:agents.general.model = "opencode/mimo-v2.5-free"` (selected by `src/admin/lib/agent-model-reconciler.ts:score(general)` + `probeModel=healthy` on the connected catalog) and never syncs `opencode.json`. Until the next container restart `OMO="opencode/mimo-v2.5-free"` vs `opencode.json=""` → CI `FAIL general native model matches persisted OMO override (expected='opencode/mimo-v2.5-free', actual='')`.

Reproduces reliably in CI because `.github/workflows/ci.yml` override mounts only 6 volumes and omits `omo-config-dev:/home/devuser/.omo`, so every `down -v` run recreates `omo.jsonc` from `/etc/opencode/omo.jsonc.default` (which has no `general`) and reconcile always creates the divergence. The 60s `sleep` before `test/run-tests.sh` also races `PROVIDER_WAIT_SECONDS=120`.

Same divergence occurs on Admin UI apply: OMO is updated and server restarted, but `opencode.json` native section was never updated, requiring a second manual restart to become effective.

## Solution

Make every OMO write a single-source sync point, reuse the existing bridge implementation:

1. **`scripts/reconcile-agent-models.sh`** — add `sync_native_overrides()` that sources `lib-native-agent-overrides.bash` (probing `/entrypoint.d/`, `../entrypoint.d/`, `/opt/ai-engkit/entrypoint.d/`) and calls `merge_native_agent_overrides "$HOME/.config/opencode/opencode.json" "$HOME/.omo/omo.jsonc"`. Call it immediately after a successful `RECONCILE_STARTUP_NO_RESTART=1 bun run ...` in the main retry loop and in the deferred 60s background retry.

2. **`src/admin/lib/agent-models.ts`** — add `syncNativeAgentOverrides()` that executes the same `jq -s '.[0] as $opencode | .[1] as $omo | reduce ["general","plan"][] ...'` via `deps.exec` (executes inside `ai-dev` via `execInAiDev`). Call it once at the end of `applyAndVerifyBatch` after the final decision (including rollback), so Admin apply and reconciler CLI share the same post-write sync. Failure to sync is non-blocking (`try/catch`).

3. **`test/run-tests.sh:631`** — make `G1` eventual-consistent: retry 6×5s (`for _ in 1 2 3 4 5 6; do ... [ "$OMO" = "$OPCODE" ] && break; sleep 5; done`) before `assert_eq`, documenting `PROVIDER_WAIT_SECONDS=120` vs startup race.

Do not add new allowlists, new env vars, or new config keys. Keep the bridge jq (`^[^/[:space:]]+/[^/[:space:]]+$`, variant handling, `del(.agent[$name])` on clear) as the single truth.

## Why It Works

* `openchamber serve` reads native models from `opencode.json:agent.<name>.model`. The bridge is the only translation of persisted `omo:agents.<name>.model` to that boundary. Running it once at ENTRYPOINT is necessary but not sufficient — any later OMO mutation (startup reconcile or Admin apply) must re-run the same translation before the next health check or test observation.
* Startup reconcile is intentionally `NO_RESTART` to avoid the `managed-opencode health timeout` (`e08fc5d` 180s lifecycle race). Syncing the file without restarting gives `G1` file equality now; runtime `G2` (actual `general` child `providerID/modelID`) still requires a restart, which the eventual-consistency test correctly separates from file equality.
* The TS-side sync via `deps.exec` guarantees Admin apply (which runs in `ai-admin` but mutates `ai-dev` via `execInAiDev`) also converges without requiring the caller to know the shell path.

## Side Effects / Tradeoffs

* File sync without restart means `G1` passes but managed server still serves the previous native model until next restart. This is intentional for `NO_RESTART` startup; document as `G1 ≠ G2`.
* Double sync (TS `deps.exec` + shell `sync_native_overrides`) is idempotent; no harm if CLI is invoked outside the shell wrapper.
* Test retry masks a 0-30s window where OMO has been written but shell sync hasn't yet run. If retry still fails after 30s, the sync itself has failed, not the race.
* `jq` failure remains soft-fail (`rm -f tmp` / `Warning: Native agent overrides skipped`) — same behavior as ENTRYPOINT bridge.

## Evidence

* CI failure: `FAIL general native model matches persisted OMO override (expected='opencode/mimo-v2.5-free', actual='')` (test/run-tests.sh:633).
* Local `test/test-native-agent-overrides.sh` — 11/11 pass after change (general/plan merge, variant, clear, allowlist, invalid model, corrupt JSON).
* `entrypoint.d/02-init-config.test.sh` — `AGENTS sync tests passed`, `exit 0` after change (lite migration tests also pass).
* `bun test src/admin/lib/agent-models.test.ts` — 31 pass, 0 fail.
* `bun test src/admin/lib/agent-model-reconciler.test.ts` — 6 pass, 0 fail (decisions: `configure_candidate` for `general`/`plan` when catalog `opencode/mimo-v2.5-free` healthy).
* `git show 0824697` — prior fix moved merge after `lean-ctx init`; `git show e08fc5d` — added `RECONCILE_STARTUP_NO_RESTART=1` + 3×30s retry + deferred 60s retry.
* New diff: `scripts/reconcile-agent-models.sh +23`, `src/admin/lib/agent-models.ts +10 (syncNativeAgentOverrides)`, `test/run-tests.sh +9 (retry loop)`.

## Related Files

* `entrypoint.d/lib-native-agent-overrides.bash` — single-source `merge_native_agent_overrides` (allowlist `["general","plan"]`, `provider/model` regex, variant handling).
* `entrypoint.d/02-init-config.sh:338` — ENTRYPOINT bridge call site (now correctly after `lean-ctx init` per 0824697).
* `scripts/reconcile-agent-models.sh:10-27` — `sync_native_overrides()` helper and post-CLI calls.
* `src/admin/lib/agent-models.ts:165` — `syncNativeAgentOverrides()` + call in `applyAndVerifyBatch`.
* `src/admin/lib/agent-model-types.ts:59` — `OMO_CONFIG="~/.omo/omo.jsonc"`, `CONFIGURABLE_NATIVE_AGENTS=["general","plan"]`.
* `src/admin/lib/agent-model-reconciler.ts:183` — `selectCandidate` capability scoring for `general`.
* `test/run-tests.sh:631` — eventual-consistency retry for `general native model` assertion.
* `test/test-native-agent-overrides.sh` — unit coverage for merge.
* `Dockerfile:285,345` — `COPY scripts/reconcile-agent-models.sh` + `CMD openchamber serve && ...reconcile... && exec logs`.
* `.github/workflows/ci.yml` — override missing `omo-config-dev` volume (amplifies reproduction).
* `docs/knowledge/patterns/native-agent-model-override-bridge.md` — original bridge design.
* `docs/knowledge/architecture/connected-provider-model-reconciliation.md` — connected catalog + readiness.
* `docs/knowledge/troubleshooting/managed-opencode-health-timeout-during-reconciliation.md` — why `NO_RESTART` exists.

## Tags

* native-agent
* general
* plan
* OMO
* opencode.json
* bridge
* reconcile
* startup-race
* eventual-consistency
* RECONCILE_STARTUP_NO_RESTART
* health-timeout
* CI
