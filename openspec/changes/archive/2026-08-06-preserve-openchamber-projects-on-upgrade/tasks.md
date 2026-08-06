## 1. Shared reconcile script (foundation for Requirement "Upgrade reconciles missing OpenChamber project registrations")

- [x] 1.1 Create `scripts/reconcile-openchamber-projects.sh`: inside the ai-dev container, list non-hidden directories under `/home/devuser/workspace`, diff against `jq '.projects[].path'` of `/home/devuser/.config/openchamber/settings.json`, and re-add missing entries using the shape-guarded atomic merge pattern (mktemp + `mv`) from `src/admin/lib/openchamber-projects.ts`; print `{"added":N}` on success
- [x] 1.2 Add a Dockerfile step to `COPY scripts/ /opt/ai-engkit/scripts/` so the script ships in the image next to `/opt/ai-engkit/VERSION`
- [x] 1.3 Smoke-test the script in a container against a scratch settings.json: idempotent (second run adds 0), add-only (stale entry not removed), no-op on fresh/missing settings.json, outputs valid JSON

## 2. Host upgrade path (`upgrade.sh`) — snapshot + reconcile + retention

- [x] 2.1 In `backup_files()`: copy the OpenChamber settings into the pre-upgrade backup dir via `docker cp ai-engkit:/home/devuser/.config/openchamber/settings.json "backup_${TIMESTAMP}/openchamber-settings.json"`; log `info` and continue when the file does not exist (fresh install)
- [x] 2.2 After the health check following container start: run the reconcile via `docker exec "$(docker compose ps -q ai-dev 2>/dev/null || echo ai-engkit)" /opt/ai-engkit/scripts/reconcile-openchamber-projects.sh`; on failure print a `warn` and continue (upgrade must not be blocked)
- [x] 2.3 Verify: `bash -n upgrade.sh` passes; retention pruning for the snapshot is covered by the existing `backup_*` cleanup (no new pruning code needed on this path)

## 3. Admin upgrade path (`src/admin/lib/upgrade.ts`) — snapshot + retention + reconcile + UI report

- [x] 3.1 In the existing `backup` step: snapshot settings.json into `backups/pre-<timestamp>/openchamber-settings.json` via `dockerCommand('cp ...')`; tolerate a non-zero exit (file missing) by logging and continuing
- [x] 3.2 Add a prune step after the backup step: read `BACKUP_RETENTION` from `.env` (default 5), delete oldest `pre-*` dirs in `BACKUP_DIR` beyond retention, mirroring `upgrade.sh` lines 163–184 — satisfies "Snapshots follow the existing backup retention policy" on the admin path
- [x] 3.3 Add a `reconcile` step after the container health-poll step: run the script via `execInAiDev('/opt/ai-engkit/scripts/reconcile-openchamber-projects.sh')`, parse `{"added":N}`; when the script is missing or exec fails, record a warning and continue
- [x] 3.4 Extend the upgrade result messaging (Requirement "Upgrade outcome is reported in the admin UI"): state "N project registrations restored" when N > 0, or "registration list is consistent; no registrations needed restoring" when 0
- [x] 3.5 Update/extend `src/admin/lib/upgrade.test.ts` (or the relevant test file) for the new snapshot/prune/reconcile steps and run the admin test suite until green

## 4. Validation

- [x] 4.1 Run `openspec validate` — all artifacts parse and the change passes validation
- [x] 4.2 Re-read both upgrade paths end-to-end against the spec scenarios: snapshot-before-recreate, restored-after-upgrade, consistent-left-unchanged, stale-never-removed, admin-report, retention-cleanup
