## Context

See proposal.md - Why. The Admin backend (ai-admin) has no workspace or lean-ctx volume mounts (docker-compose.yml mounts only `.env`, `compose.yml`, `admin-data`, `backups`, and the Docker socket), so every per-project probe must run **inside the ai-dev container** through the existing `execInAiDev()` helper (`src/admin/lib/docker.ts` L117-124), which is already the established pattern for all project operations. Existing per-row enrichment is `loadFeatures()` in `src/admin/views/projects.tsx` consuming `GET /api/projects/overview` (`src/admin/routes/projects.ts` L48-59, `src/admin/lib/projects-overview.ts` `collectProjectOverviews` L40-73).

Research-established facts this design relies on:
- `codegraph status --json <path>` returns `{initialized, version, projectPath, indexPath, lastIndexed, fileCount, nodeCount, edgeCount, dbSizeBytes, backend, journalMode, nodesByKind, languages, pendingChanges{added,modified,removed}, worktreeMismatch, index{builtWithVersion, builtWithExtractionVersion, currentExtractionVersion, reindexRecommended, state, pendingRefs}}`. Runs standalone (read-only SQLite open), no daemon/HTTP dependency. Absent index → `initialized:false` (exit 0).
- leanCTX state lives under `~/.local/share/lean-ctx/` inside ai-dev, keyed by project hash: `knowledge/<hash>/knowledge.json` (per-project facts incl. `project_root`), `agents/registry.json` (`project_root`, `status`, `last_active`), `graphs/<hash>/health.json` (cached health score, sparse — only 4/24 projects have one). The live "active session" slot (`context-os/sessions/.../session.json`) is global, not per-project, and must not be displayed as a per-project signal.
- leanCTX is a site-level signal by design: per-project attribution is unreliable (session activity is global; health scores exist for only a minority of projects; a single project's fact count is low-signal on its own). The meaningful shape is the aggregate across all projects, which one site-wide scan of the above state files produces in a single pass.
- The leanCTX "Context Cockpit" dashboard (port 3333) is a human-facing telemetry front-end: not running by default, bearer-token auth, not published in compose, no codegraph data, no programmatic embed path. Not a status source for this feature.

## Goals / Non-Goals

**Goals**
- Expose per-project codegraph status (indexed?, counts, lastIndexed, pendingChanges, reindexRecommended) through `/api/projects/overview`.
- Render a CodeGraph column in the projects table with tooltip detail.
- Expose site-level leanCTX statistics (projectsWithFacts, totalMemoryFacts, activeProjects24h, healthCoverage) through `/api/status` and render them in the Dashboard "Projects" card.
- Keep probes read-only, time-bounded, cached, and non-blocking.

**Non-Goals**
- No per-project leanCTX fields in the projects overview or UI — leanCTX is a site-level signal and per-project attribution is unreliable.
- No "session active" indicator anywhere (leanCTX live session is global — misleading).
- No on-demand `lean-ctx health` computation (expensive); cached `health.json` values only, aggregated.
- No embedding or proxying of the leanCTX dashboard.
- No changes to existing `/api/status` fields — the leanCTX statistics are additive.

## Decisions

### 1. Codegraph probe = `codegraph status --json` via execInAiDev
Run `codegraph status --json <workspace>/<project>` inside ai-dev with a timeout; parse JSON; on timeout/malformed output/CLI missing → `null` for that project.

Alternatives considered:
- **Direct SQLite read** of `<project>/.codegraph/codegraph.db` — rejected: hand-rolls schema parsing (`files`/`nodes`/`edges`/`project_metadata`), fragile across engine versions, and the CLI already normalizes `initialized:false` and the full shape.
- **MCP/daemon protocol** — rejected: `daemon.sock` speaks newline-delimited JSON-RPC (MCP), not HTTP, and the `codegraph_status` MCP tool is not in the default tool set; the CLI is the supported programmatic surface.

### 2. leanCTX statistics = one site-wide scan inside ai-dev
Run a single scan per dashboard window: read every `knowledge/<hash>/knowledge.json` (sum of fact counts → `totalMemoryFacts`; count of projects with facts → `projectsWithFacts`), `agents/registry.json` (count of distinct `project_root` entries with `last_active` within 24h → `activeProjects24h`), and `graphs/<hash>/health.json` (count of projects with a cached score → `healthCoverage`). No per-project hash resolution is needed — the scan covers all knowledge dirs in one pass, so the earlier per-project probe approach is retired.

Alternatives considered:
- **Per-project probe (original design)** — rejected after research: per-project attribution is unreliable (session activity is global, health scores are sparse, single-project fact counts are low-signal), and a per-project column would present noise as signal.
- **`lean-ctx token-report --json` / `knowledge status`** — rejected: CLI startup per call is heavier, output mixes telemetry we don't display (savings/CEP), and the fields we need are exactly the three files above, which are fast to read and need no subprocess.
- **Querying `~/.config/openchamber/settings.json` for path mapping** — unnecessary; the scan aggregates over whatever `knowledge/` contains, with no path mapping required.

### 3. Probe transport: single `sh -c` per project, shell-quoted
Because the Admin container cannot reach the files directly, each probe is one `docker exec <ai-dev> sh -c <cmd>` where `<cmd>` quotes the project name safely (no user-controlled content interpolated unquoted). Keep every probe read-only.

### 4. Bounded + cached probes
- Per-probe timeout (e.g. 10s via `timeout`(1) inside ai-dev) so one stuck project never blocks the overview.
- In-memory TTL cache (e.g. 300s) keyed by project name, holding the parsed `codegraph`/`leanctx` objects (including `null` for failures — a failed probe is also cached, so a broken project doesn't get hammered).
- Concurrent probing (bounded, e.g. 4-8 in flight) so N projects don't serialize.
- Cache invalidated when project sync runs (`syncProjects`), so new projects are probed on first overview.

### 5. UI: CodeGraph column on projects; leanCTX card on Dashboard
Extend the `ProjectOverview` type and `collectProjectOverviews` with `codegraph`, then extend the projects table header/rows (`views/projects.tsx` L26-37) and `loadFeatures()` with a single CodeGraph column reusing the existing badge idiom (`badge badge-success` / `badge badge-warning`) plus a title/tooltip carrying detail. Not-indexed = neutral badge; probe failure = muted "unknown". The leanCTX statistics land in the Dashboard "Projects" card (`views/dashboard.tsx`, `DashboardData`) fed by the new additive `/api/status` fields; when the site scan failed they render as unavailable.

### 6. leanCTX semantics guard
Only site-level aggregates are shown: `projectsWithFacts`, `totalMemoryFacts`, `activeProjects24h`, `healthCoverage`. No per-project breakdown, no derived "active" state, no savings/telemetry numbers — those are the Context Cockpit's domain.

## Risks / Trade-offs

- **`codegraph status` cost is O(files) per call** (git-status + content-hash scan) → bounded by the TTL cache + per-probe timeout; null results are cached too. If a repo is enormous, tune TTL/probe time in config rather than removing the feature.
- **Project names with shell metacharacters** → all interpolated values are single-quoted in the `sh -c` string; probe commands contain no unquoted user input.
- **Site leanCTX scan is O(knowledge dirs)** → one pass per dashboard window (~24 dirs, negligible); the result is cached like the codegraph probes so the Dashboard does not re-scan on every load.
- **ai-dev container down / socket unreachable** → every probe fails to unavailable; page still renders with unknown placeholders (spec'd behavior). Restart of ai-admin clears the in-memory cache harmlessly.
- **`reindexRecommended` is engine-version-based and may be noisy** (e.g. current repo index built by an older engine) → surfaced as a tooltip warning only, never as an error badge.
- **health.json is sparse** (only present after a health/graph run) → surfaced as a site-level coverage count, never as per-project values.

## Migration Plan

- Additive API fields (`codegraph` per project in the overview payload; `leanctx` site statistics in `/api/status`) — existing consumers ignore unknown fields, so the API change is backward compatible.
- UI additions (CodeGraph column, Dashboard card) are additive; rollback is reverting the projects.tsx column/JS and dashboard.tsx card, with the backend fields harmless to leave in place.
- No schema/DB migration; the TTL cache is in-memory and clears on restart. No external dependencies added (codegraph CLI and lean-ctx binary/state are already inside ai-dev).

## Open Questions

- Exact TTL/probe-timeout values and tooltip formatting details — implementation choices that do not change the spec or the approach.
- Which site-level leanCTX statistics to surface beyond the initial four (e.g. activity window length, average health score) — additive, can be decided after first release.
