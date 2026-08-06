## Context

Two independent upgrade paths exist (see `docs/knowledge/patterns/compose-change-upgrade-checklist.md`):

| Path | Runner | Backup dir | Retention pruning |
|---|---|---|---|
| `upgrade.sh` (host) | host shell | `backup_<TIMESTAMP>/` in the install dir | yes — `BACKUP_RETENTION` (default 5) |
| Admin UI (`runUpgrade()` in `src/admin/lib/upgrade.ts`) | inside `ai-engkit-admin` via docker.sock | `backups/pre-<timestamp>/` (host `./backups`) | **none today** |

Both recreate `ai-engkit` (ai-dev) from `ghcr.io/tryweb/ai-engkit:latest`. The OpenChamber registration list lives at `/home/devuser/.config/openchamber/settings.json` inside ai-dev (named volume `*-openchamber-data`); workspace project directories live at `/home/devuser/workspace` (bind or named volume). OpenChamber version changes can re-initialize `settings.json` and drop the `projects` array while the workspace data stays intact — see `docs/knowledge/troubleshooting/openchamber-projects-lost-after-upgrade.md` for the incident evidence.

Existing primitives: `execInAiDev()` / `dockerCommand()` (`src/admin/lib/docker.ts`), atomic jq merge in `src/admin/lib/openchamber-projects.ts` (`mergeOpenChamberProject`, shape-guarded, mktemp + `mv`), and `upgrade.sh`'s `backup_files()` + retention pruning.

## Goals / Non-Goals

**Goals:**
- Both upgrade paths snapshot `settings.json` into their own pre-upgrade backup directory before recreating containers.
- Both paths reconcile missing registrations after the upgrade using **one shared implementation**.
- Reconcile is add-only, idempotent, and never removes entries.
- Admin UI upgrade reports the reconcile outcome (restored count or "already consistent").
- Admin-path snapshots fall under the same `BACKUP_RETENTION` cleanup as host-path backups.

**Non-Goals:**
- No change to OpenChamber itself (upstream re-initialization is out of our control).
- No auto-removal of stale registrations (deliberately out of scope; requires human judgment).
- No snapshot of sessions/tasks/DBs — only the registration list is at risk from this failure mode.
- No change to the create-project / manual-sync routes (existing primitives are reused as-is).

## Decisions

### D1: Single reconcile script in the image, executed via `docker exec` from both paths

New script `scripts/reconcile-openchamber-projects.sh`, baked into the image at `/opt/ai-engkit/scripts/reconcile-openchamber-projects.sh` (next to the existing `/opt/ai-engkit/VERSION`). It runs **inside ai-dev** (fixed paths: `/home/devuser/workspace`, `/home/devuser/.config/openchamber/settings.json`), lists workspace dirs, diffs against `jq '.projects[].path'`, and re-adds missing entries using the same shape-guarded atomic merge pattern as `openchamber-projects.ts`. Prints `{"added":N}` on success.

- `upgrade.sh`: `docker exec "$(docker compose ps -q ai-dev 2>/dev/null || echo ai-engkit)" /opt/ai-engkit/scripts/reconcile-openchamber-projects.sh`
- `upgrade.ts`: `execInAiDev("/opt/ai-engkit/scripts/reconcile-openchamber-projects.sh")` in a new `reconcile` step after `poll_health`.

Rationale: one implementation means the host and admin paths can never drift, and it is versioned with the image so behavior matches the deployed release. **Alternative rejected:** TS-side reuse of `mergeOpenChamberProject` for the admin path plus a separate shell implementation for the host path — two copies of the same diff logic that will drift.

### D2: Snapshot into each path's existing backup directory

- `upgrade.sh` → `backup_<TIMESTAMP>/openchamber-settings.json`, added inside `backup_files()` (step 3, before compose changes). Read via `docker cp ai-engkit:/home/devuser/.config/openchamber/settings.json "$backup_dir"/`. Tolerate a missing file (fresh install / no settings yet) with an `info` message.
- `upgrade.ts` → `backups/pre-<timestamp>/openchamber-settings.json`, added in the existing `backup` step (step 2). Read via `dockerCommand('cp <ref>:/home/devuser/.config/openchamber/settings.json <backupPath>/')` — `docker cp` avoids shell-quoting the JSON content. Tolerate exit != 0 (file missing) by logging and continuing.

Rationale: keeps the existing naming conventions per path and puts the snapshot next to the compose/.env copies it belongs with. **Alternative rejected:** a single shared backup location — would break each path's established layout and the host path's existing pruning logic.

### D3: Add `BACKUP_RETENTION` pruning to the admin upgrade path

`upgrade.ts` currently creates `pre-*` backups forever. Add a prune step (mirroring `upgrade.sh` lines 163–184): after the backup step, read `BACKUP_RETENTION` from `.env` (via `readEnvFile`, default 5), list `pre-*` dirs in `BACKUP_DIR`, delete oldest beyond retention. This is required so the new snapshot satisfies the spec's retention requirement on both paths.

### D4: Reconcile is a soft step — failures warn, never block the upgrade

The registration loss is recoverable manually (snapshot + existing sync UI), so a reconcile failure must not roll back a successful container recreate. In `upgrade.ts`, the `reconcile` step reports `success` with the `{"added":N}` count, or a `warning`-style message when the script is absent (image older than this change) — recorded in the event log and surfaced in the UI result. In `upgrade.sh`, reconcile failures print a `warn` and continue.

## Risks / Trade-offs

- **`docker exec` into ai-dev requires the container to be up post-upgrade** → both paths run reconcile after their health/poll step, and treat exec failure as a warning (manual sync remains the fallback).
- **Script missing on pre-change images** (e.g. an admin upgrade that fails between recreate and reconcile) → reconcile warns and skips; the snapshot still exists for manual recovery. First successful upgrade after this change always ships the script, so this is a one-time transition risk.
- **jq dependency inside the container** → already present (existing `openchamber-projects.ts` relies on it).
- **Admin-path pruning is new behavior on existing `pre-*` dirs** → only deletes beyond `BACKUP_RETENTION`, same policy the host path already applies; nothing is deleted below the retention count.
- **Reconcile only repairs the registration list** → sessions/tasks live elsewhere; unaffected and out of scope (stated in the spec).

## Migration Plan

1. Ship the script in the next image release (Dockerfile `COPY scripts/ /opt/ai-engkit/scripts/`).
2. Deploy the new `upgrade.sh` via the normal update flow; existing installs get it on their next upgrade.
3. First upgrade after deploy: snapshot + reconcile run automatically on both paths; no manual step.
4. Rollback: revert the image/script change. Existing backups and the manual sync UI are untouched, so recovery paths stay available regardless.

## Open Questions

None — the deferred details (exact shell quoting in the script, Dockerfile copy path) are implementation-level and do not change the spec, the approach, or the task breakdown.
