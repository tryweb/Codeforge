## Why

The Admin projects page lists every workspace project but only shows feature flags (`knowledge`/`maintenance`/`openspec`), git remote, and disabled state — it cannot answer "is this project ready for AI-assisted work". Codegraph index health is a direct per-project signal of that readiness and is cheaply readable via `codegraph status --json <path>` (no daemon or HTTP API required). leanCTX is a site-level context store: per-project facts live under `~/.local/share/lean-ctx/` keyed by project hash, but the meaningful signal — total memory facts, which projects have context, recent activity, health coverage — is site-wide, so it belongs on the Dashboard rather than in a per-project column. The leanCTX "Context Cockpit" dashboard is a human-facing telemetry front-end (tokens/savings/doctor) that is not running by default, is not exposed to the Admin container, and contains no codegraph data — it does not and cannot replace the Dashboard's site-level statistics.

## What Changes

- `GET /api/projects/overview` response is extended with per-project codegraph status: `codegraph: { initialized, fileCount, nodeCount, edgeCount, lastIndexed, pendingChanges, reindexRecommended, state } | null` (null when the probe fails).
- No per-project leanCTX fields are added to the overview: leanCTX is a site-level signal and per-project attribution is unreliable (session activity is global, health scores are sparse). Instead `GET /api/status` (the Dashboard data source) is extended with site-level leanCTX statistics: `leanctx: { projectsWithFacts, totalMemoryFacts, activeProjects24h, healthCoverage }`.
- The Admin projects table gains a "CodeGraph" column (indexed / not indexed badge, lastIndexed + counts + pending/reindex warnings in a tooltip); the "Projects" card on the Dashboard gains the site-level leanCTX statistics above.
- All probes run inside the ai-dev container via the existing `execInAiDev` path (the Admin container has no workspace/lean-ctx volume mounts); each project's codegraph result is cached with a TTL so the overview page does not re-scan on every load.
- Error semantics: a missing `<project>/.codegraph/` is a valid "not indexed" state (`initialized:false`), not an error; a failed probe renders as "unknown" without failing the page; a failed leanCTX site scan renders the Dashboard statistics as unavailable without failing the page.
- Non-goals: no live session "active" indicator anywhere (leanCTX's live session slot is global and would mislead), no health-score computation on demand (only cached `graphs/<hash>/health.json` values are aggregated), no embedding of the leanCTX dashboard.

## Capabilities

### New Capabilities
- `admin-project-status`: per-project codegraph index status surfaced through the Admin projects overview API and UI, plus site-level leanCTX statistics surfaced through the Admin Dashboard (`/api/status`).

### Modified Capabilities
<!-- None. The archived project-feature-* capabilities (project-sync, project-git-remote, project-feature-status, project-feature-enable) were never synced into main specs; no existing main capability's requirements change. -->

## Impact

- **Code**: `src/admin/routes/projects.ts` (overview handler), `src/admin/lib/projects-overview.ts` (`ProjectOverview` type + `collectProjectOverviews`), a new probe/cache helper (mirroring the existing `execInAiDev` shell-out pattern in `src/admin/lib/docker.ts`), `src/admin/views/projects.tsx` (CodeGraph column + tooltip rendering), `src/admin/lib/status.ts` + `src/admin/views/dashboard.tsx` (site-level leanCTX statistics in the Projects card).
- **Dependencies**: none added — the codegraph CLI (`codegraph status --json`) and lean-ctx CLI/state files are already present inside ai-dev.
- **Tests**: extend `test/test-admin-ui.sh` coverage for the codegraph overview payload shape, the not-indexed/unknown rendering paths, and the Dashboard leanCTX statistics.
- **Performance**: codegraph status performs a git-status + content-hash scan per call (O(files)); the TTL cache bounds this to once per project per window, and probe timeouts prevent a stuck project from blocking the overview.
