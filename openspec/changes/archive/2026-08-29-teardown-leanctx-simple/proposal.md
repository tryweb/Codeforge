# Teardown: LeanCTX Simple Config

## Why

The LeanCTX Admin configuration feature accumulated lifecycle machinery that no
longer earns its cost: a status hash/snapshot collector, a drift sentinel with
report UI, a doctor route, and per-key set/delete endpoints that bypass the
structured form. Each layer duplicates state the persisted global config already
holds, and Apply restarts the whole ai-dev container when the lean-ctx CLI
already restarts its own daemon. The approved direction is a materially smaller
feature: image baseline + global persisted config + schema-driven structured
form, with Apply delegating to `lean-ctx config apply` only.

## What Changes

- Replace the lifecycle/drift-heavy `leanctx-admin-config` contract with five
  requirements: canonical image baseline, global persisted config seeded only
  when absent, structured schema Save/Reset/Validate, Apply via
  `lean-ctx config apply` without full container recreation, and local
  dirty/saved UI state.
- Remove the drift/status/doctor/set/delete Admin behaviors intentionally:
  - `GET /api/leanctx/drift`, `GET /api/leanctx/status`, `GET /api/leanctx/doctor`
  - `POST /api/leanctx/config/set`, `POST /api/leanctx/config/delete`
  - `src/admin/lib/leanctx-drift.ts` (sentinel hash/snapshot detector) and its
    tests; `leanctx-status.ts` / `leanctx-runtime.ts` have no live imports on
    this branch and no files need deleting for them.
  - Drift warning UI, lifecycle hash/snapshot UI, and the doctor button/modal.
- Apply becomes exec-only: it runs `lean-ctx config apply` and reports the
  result. It MUST NOT call `restartAiDev`, sleep, or recreate the ai-dev
  container; the lean-ctx CLI restarts its own daemon process.
- Project-layer config handling (`PROJECT_CONFIG_PATH` merge/override) is
  removed from the Admin feature; the persisted global config is the only
  user-writable layer the Admin UI manages.
- Keep the malformed-TOML 409 save behavior and baseline-derived Reset.
- Keep `docker/lean-ctx/config.default.toml` and the entrypoint seed/migration
  behavior unchanged; `lean-ctx` remains the external pinned v3.9.20 CLI.

## Capabilities

### Modified Capabilities

- `leanctx-admin-config`: the delta spec removes the drift report, reliability
  gate, and daemon-restart Apply requirements and rewrites the contract around
  the five simplified requirements above.

## Impact

- `src/admin/routes/leanctx.ts`, `src/admin/lib/leanctx.ts`,
  `src/admin/views/leanctx-editor.tsx` shrink substantially.
- `src/admin/lib/leanctx-drift.ts` and `src/admin/lib/leanctx-drift.test.ts`
  are deleted.
- Route, view, and E2E tests are rewritten to the new contract; the standalone
  reliability-gate eval harness under `test/lib/leanctx-eval/` is untouched and
  no longer part of the Admin capability contract.
