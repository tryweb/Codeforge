# OpenChamber Projects Sync — Container Targeting & Timestamp Gap

## Context

The admin dashboard's Projects page has a "↻ Sync" button (`src/admin/views/projects.tsx`). It reconciles workspace directories against OpenChamber's project registry: it lists what is missing from `settings.json` (`missingInOC`, to be added) and what is stale (`staleInOC`, to be removed), then applies the diff.

The admin container runs alongside two possible ai-dev siblings. Which one the sync operates on is decided by the admin container's own name — this is the trap.

## Problem

A user ran Projects → Sync expecting the production OpenChamber to regain its 23 workspace projects and got "All projects are in sync" (0 missing, 0 stale) — nothing came back.

## Solution

### Root cause: sync targets the *sibling* container, not "production"

`execInAiDev()` resolves the target via `getAiDevContainerRef()` (`src/admin/lib/docker.ts`): it strips the `-admin` / `-admin-dev` suffix from the **admin container's own name** to find its sibling, then `docker exec`s into it:

| Admin container | Resolved sibling | Workspace content |
|---|---|---|
| `ai-engkit-admin` (prod, port 8380) | `ai-engkit` | bind mount — 23 project dirs |
| `ai-engkit-admin-dev` (dev, port 8081) | `ai-engkit-dev` | isolated `workspace-dev` volume — 2 test dirs |

The dev admin therefore compares the dev container's own tiny workspace against the dev container's own `settings.json` — always in sync. **It can never see or restore production projects.** The prod admin (8380) is the only one that operates on the real workspace.

### Fix (executed 2026-08-02)

On the **prod admin (8380)** the sync correctly reported 21 missing projects; the POST applied all 21:

```
GET  /api/projects/sync  → {"missingInOC":[21 projects],"staleInOC":[]}
POST /api/projects/sync  {"add":[...21...],"remove":[]} → {"ok":true,"messages":21}
settings.json projects: 3 → 24
```

No code change was needed — it was a usage/container-targeting misunderstanding.

## Why It Works

- OpenChamber's project list is read directly from `settings.json` → `projects[]` (`server/lib/opencode/settings-normalization-runtime.js` — `sanitizeProjects`), so appending entries via the admin's `jq` write makes them appear in the UI without restart.
- `sanitizeProjects` only requires `id` + `path` to be present. **Missing `addedAt`/`lastOpenedAt` does not drop the entry** — the fields are simply omitted from the output and treated as 0 for sorting (project sorts last, warms up last). Rendering is unaffected.
- The workspace-root entry (path `/home/devuser/workspace`) is excluded from the comparison because the query filters with `startswith("/home/devuser/workspace/")`.

## Side Effects / Tradeoffs

- **Timestamp gap**: the sync POST writes entries as `{"id": "path_<base64>", "path": ...}` with **no timestamps**, unlike the create endpoint (`POST /api/projects`) which adds `addedAt`/`lastOpenedAt` via `date +%s%3N`. Cosmetic today — projects render fine — but a future OpenChamber that validates those fields would misbehave.
- **Sessions are separate**: sync only fixes the project registry. Archived session history (`sessions-directories.json` `__archived__` entries) is untouched; session data itself lives in the opencode SQLite DB and was verified intact (4327/4327).
- **Idempotent**: re-running sync after a fix reports 0 missing — safe to repeat.

## Evidence

- Verified both admins live on 192.168.11.196: dev admin (8081) returns `{"missingInOC":[],"staleInOC":[]}`; prod admin (8380) returns 21 missing, 0 stale.
- End-to-end dry run on dev: delete `test-003` from `settings.json` → sync reports it missing → POST re-adds it → entry present (without timestamps) → dev state restored from backup afterwards.
- Post-fix UI check via Playwright on prod OpenChamber (container port 3000): all 21 projects visible in the sidebar (ai km, text to cad, jt ipam, …).
- Backups taken before mutation: prod `settings.json` copied to `/tmp/settings.pre-sync.bak` inside the prod container.

## Related Files

- `src/admin/routes/projects.ts` — GET/POST `/api/projects/sync`, `listProjects()`, `getOpenChamberProjects()`
- `src/admin/views/projects.tsx` — `syncProjects()` / `applySync()` UI flow
- `src/admin/lib/docker.ts` — `getAiDevContainerRef()` / `execInAiDev()` sibling resolution
- `docs/knowledge/patterns/openchamber-project-auto-registration.md` — the *create* endpoint's timestamped registration (complementary; sync differs)
- `docs/knowledge/architecture/admin-env-editor-dataflow.md`

## Tags

`openchamber` `admin` `projects-sync` `settings-json` `sibling-container` `docker-exec` `prod-vs-dev`
