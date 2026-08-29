# LeanCTX Admin Simple Config

## Context

The LeanCTX Admin configuration feature was simplified in PR #67. The previous implementation included a drift sentinel, status and doctor routes, project-layer handling, lifecycle snapshots, and container restart logic around Apply.

## Problem

The removed layers duplicated the persisted global configuration and made Apply responsible for restarting the whole `ai-dev` container even though the LeanCTX CLI owns its daemon restart.

## Solution

- `/etc/lean-ctx/config.default.toml` is the immutable image baseline.
- `/home/devuser/.config/lean-ctx/config.toml` is the only Admin-managed writable layer and is seeded only when absent.
- The structured UI provides Save, Reset, and Validate; malformed global TOML returns HTTP 409 until Reset repairs it.
- Reset fully replaces the global file with the current baseline, including removal of stale dotted-key sections.
- Flat schema keys such as `archive.enabled` are expanded into nested TOML tables before full serialization.
- Apply executes `lean-ctx config apply` only; it does not recreate `ai-dev`, sleep, or poll.
- The UI derives Apply availability from local dirty/saved state rather than status or drift endpoints.

## Why It Works

The image baseline and global file have explicit ownership, while the CLI remains responsible for daemon lifecycle. Full replacement prevents stale overrides from surviving Reset, and nested serialization preserves the runtime meaning of dotted configuration keys.

## Side Effects / Tradeoffs

- Drift/status/doctor/set/delete Admin routes and lifecycle drift UI are intentionally removed.
- The reliability gate is no longer part of the `leanctx-admin-config` capability; the standalone evaluation harness remains separate.
- The explicit compression-off migration and entrypoint seed behavior remain unchanged.

## Evidence

- PR #67, merge commit `a569566`.
- Admin tests: 516 passed.
- LeanCTX Playwright E2E: 5 passed.
- `openspec validate teardown-leanctx-simple --strict`: passed.
- Docker Compose dev image built successfully and both `ai-dev` and `ai-admin` services started.

## Related Files

- `openspec/specs/leanctx-admin-config/spec.md`
- `src/admin/lib/leanctx.ts`
- `src/admin/routes/leanctx.ts`
- `src/admin/views/leanctx-editor.tsx`
- `docker/lean-ctx/config.default.toml`
- `entrypoint.d/02-init-config.sh`

## Tags

`lean-ctx` `admin` `simple-config` `architecture`
