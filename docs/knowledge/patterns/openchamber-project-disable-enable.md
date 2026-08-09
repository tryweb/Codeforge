# OpenChamber Project Disable / Enable (Unregister + State File)

## Context

ai-engkit's admin dashboard lets users create projects in `~/workspace/` and registers them in OpenChamber's `settings.json` (`projects` array). Users asked for a way to hide a project from OpenChamber without deleting its directory — a "disable" feature that survives container restarts and the boot-time reconcile pass.

OpenChamber reads its registry only from `settings.json`'s `projects` array. Its settings normalization (`settings-runtime.js`, `sanitizeProjects`) strips unknown fields from entries and drops registrations whose path fails `fs.stat` during a persist.

## Problem

OpenChamber has no "hide" concept. A flag embedded inside a project entry cannot work — the normalizer strips it. Deleting the directory is destructive (user data). The only reliable way to hide a project is to **remove its registration**; the challenge is keeping that hidden state consistent across:

- the admin API (disable/enable round-trip),
- the boot reconcile script (`entrypoint.d/07-reconcile-openchamber.sh` + `scripts/reconcile-openchamber-projects.sh`), which re-adds registrations after the boot-time mount race,
- the sync "Fix All" endpoint, which offers to re-register missing projects.

## Solution

Disable = **unregister from `settings.json`** + **record the name in an ai-engkit-owned state file**; enable = the inverse.

State file (ai-engkit owns it, sits beside OpenChamber's settings so it lives in the same persistent volume):

```
/home/devuser/.config/openchamber/disabled-projects.json   →  {"disabled": ["name1", ...]}
```

Flow, per endpoint (`src/admin/routes/projects.ts`):

- `POST /api/projects/:name/disable` — mark first, then unregister; if unregister fails, **roll the mark back** (state file and OpenChamber stay consistent, retry is safe).
- `POST /api/projects/:name/enable` — unmark, then re-register; if re-registration fails there is **no rollback** — the next reconcile pass re-adds it automatically.
- `POST /api/projects` (create) — always clears the disabled mark, so a recreated project is never masked.
- `GET /api/projects/overview` — each entry carries `disabled: boolean` for the UI badge/toggle.

The other consumers must honor the state file:

- `scripts/reconcile-openchamber-projects.sh` — reads the disabled list and skips those directories (`grep -Fxq -- "$name" "$disabled_file"`), so neither the manual nor the boot reconcile re-adds a disabled project.
- `src/admin/routes/project-sync.ts` — filters disabled names out of `missingInOC`, so "Fix All" never re-registers one.

State-file writes (`src/admin/lib/openchamber-projects.ts`, `mergeDisabledProject`) mirror the settings merge pattern: jq program with a shape guard, `umask 077`, `mktemp` + atomic `mv`, and a jq verify pass after the write.

## Why It Works

OpenChamber only lists what is in `settings.json`'s `projects` array — removing the entry hides the project immediately, no restart or API call needed (the UI re-reads the file). The disabled list is the single source of truth ai-engkit checks everywhere *it* re-adds registrations (reconcile, sync), so nothing resurrects a disabled project. The directory is never touched, so user data and git history are safe.

Malformed state file fails safe: jq parse failure → empty disabled list → nothing is hidden (visible beats silently-hidden).

## Side Effects / Tradeoffs

- **Unregister means the project leaves OpenChamber entirely** — label, last-opened ordering, and any OpenChamber-side metadata are lost and rebuilt from scratch on re-enable. Acceptable: OpenChamber derives the label from the directory name.
- **Re-enable requires the directory to still exist** — the endpoints 404 on a missing directory.
- **Malformed state file silently re-enables everything** (fail-safe side). Tradeoff accepted: never hide without intent.
- If the state file and `settings.json` drift (e.g. someone edits OpenChamber's file directly), the reconcile pass only re-adds missing ones; a manual sync is the repair path.

## Evidence

Verified end-to-end in the dev compose stack (`docker-compose.dev.yml`, image `ai-engkit-ai-dev`, admin on `:8081`):

- Disable `e2e-test` → `settings.json` entry removed, `disabled-projects.json` = `["e2e-test"]`, overview `disabled: true`.
- Reconcile (manual ×2 AND container restart boot pass) → both `{"added":0}`, project stays hidden; boot log: `[reconcile-openchamber] consistent, nothing to restore`.
- Enable → re-registered in `settings.json`, disabled list `[]`, overview `disabled: false`.
- Sync filter: a non-disabled unregistered project appears in `missingInOC`; after disabling it, it disappears.
- Unit tests (run from `src/admin`): 46 pass / 0 fail, incl. disable/enable/rollback/sync-filter cases.

## Related Files

- `src/admin/routes/projects.ts` — disable/enable/create endpoints, overview
- `src/admin/lib/openchamber-projects.ts` — `mergeDisabledProject` / `readDisabledProjects`
- `src/admin/routes/project-sync.ts` — disabled filter in `missingInOC`
- `scripts/reconcile-openchamber-projects.sh` — disabled skip in reconcile
- `docs/knowledge/patterns/openchamber-project-auto-registration.md` — the create/register side of the same registry
- `docs/knowledge/troubleshooting/openchamber-projects-pruned-on-restart-mount-race.md` — why the reconcile pass exists
- `docs/knowledge/tooling/openchamber-project-data-architecture.md` — settings.json data model

## Tags

`openchamber` `projects` `disable` `enable` `settings-json` `reconcile` `state-file` `admin`
