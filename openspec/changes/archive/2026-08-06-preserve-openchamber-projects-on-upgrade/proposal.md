## Why

After an image upgrade, OpenChamber's project registration list (`settings.json` → `projects[]`) can be re-initialized by an OpenChamber version change, making the UI show fewer projects while all project data on disk remains intact. This happened twice on the production host 192.168.11.196 (2026-08-02 and 2026-08-06); each time recovery required a manual admin sync. The upgrade pipeline currently snapshots only `compose.yml` and `.env`, so a dropped registration list cannot be compared or restored automatically.

## What Changes

- Upgrade — **both** the host path (`upgrade.sh`) and the admin UI path (`runUpgrade()` in `src/admin/lib/upgrade.ts`) — snapshots the OpenChamber `settings.json` (from the `openchamber-data` volume, e.g. `jonathan_openchamber-data`) into the existing pre-upgrade backup directory used by that path (`backups/pre-<timestamp>/` for the admin UI, `backup_<TIMESTAMP>/` for the host script) before recreating containers.
- After upgrade, both paths run a registration-consistency check that compares workspace project directories against `settings.json` `projects[]` entries. Missing registrations are re-added automatically using the existing atomic merge primitive. The reconcile is **add-only and idempotent**: it never removes entries, and re-running it is a no-op when nothing is missing.
- The admin UI reports the post-upgrade outcome (count of registrations restored, or that the list is already consistent).
- Snapshot retention follows the existing `BACKUP_RETENTION` setting. The upgrade result is safe even if the registration list was already intact (snapshot is still taken; reconcile adds nothing).

## Capabilities

### New Capabilities

- `admin-upgrade`: upgrade pipeline behavior for preserving OpenChamber state — pre-upgrade snapshot of the registration list, post-upgrade registration reconciliation, and snapshot retention.

### Modified Capabilities

- (none)

## Impact

- `upgrade.sh` — host upgrade path gains snapshot + reconcile steps.
- `src/admin/lib/upgrade.ts` — admin UI upgrade path gains the same steps.
- `src/admin/lib/openchamber-projects.ts` / `src/admin/routes/project-sync.ts` — reused for the reconcile (no API change required, existing primitives cover add-only merge and directory listing).
- `backups/` layout — `pre-*` snapshot directories now include the OpenChamber `settings.json`.
- Documentation — `docs/knowledge/troubleshooting/openchamber-projects-lost-after-upgrade.md` remains the diagnostic reference; behavior it describes becomes automated.
