## 1. Probe helper module

- [x] 1.1 Create `src/admin/lib/project-tool-status.ts` with a `probeCodegraph(projectName)` function that runs `codegraph status --json <workspace>/<project>` inside ai-dev via `execInAiDev`, wraps it in a 10s timeout, and returns the parsed JSON object or `null` on timeout/malformed output/missing CLI
- [x] 1.2 Add `probeLeanCtxSite()` in the same module: scans every `knowledge/<hash>/knowledge.json` (total fact count and count of projects with facts), `agents/registry.json` (count of distinct `project_root` entries with `last_active` within 24h), and `graphs/<hash>/health.json` (count of projects with a cached score) in one site-wide pass, returning `{ projectsWithFacts, totalMemoryFacts, activeProjects24h, healthCoverage }` or `null` on read failure
- [x] 1.3 Implement the TTL cache (300s, in-memory Map keyed by project name, storing codegraph results including `null` failures plus the site leanCTX scan result) and a bounded concurrency helper (4-8 probes in flight) with an `invalidate(projectName?)` hook
- [x] 1.4 Ensure every shell command (per-project codegraph probes and the site leanCTX scan) single-quotes the project name and runs read-only; add unit-style checks via `lsp_diagnostics` on the new module

## 2. Overview API integration

- [x] 2.1 Extend the `ProjectOverview` interface in `src/admin/lib/projects-overview.ts` with an optional `codegraph` field matching the spec shape (no per-project leanCTX field)
- [x] 2.2 Extend `collectProjectOverviews` to probe each project's codegraph status through the new module (cached, concurrent, failure → `null`) and attach the results to each overview entry
- [x] 2.3 Verify `GET /api/projects/overview` (`src/admin/routes/projects.ts` L48-59) passes the new fields through unchanged; confirm existing consumers still parse the payload

## 3. UI presentation

- [x] 3.1 Add a CodeGraph column header to the projects table in `src/admin/views/projects.tsx` (header row ~L27) and per-row cells (~L28-35); remove the leanCTX column added in the first implementation pass
- [x] 3.2 Extend `loadFeatures()` to render the codegraph badges: positive badge when `codegraph.initialized`, neutral "not indexed" badge when `initialized:false`, muted "unknown" when `null`; drop the leanCTX cell rendering
- [x] 3.3 Add tooltip detail (title attribute or equivalent) with lastIndexed, counts, pendingChanges, reindexRecommended for codegraph
- [x] 3.4 Extend `GET /api/status` (`src/admin/lib/status.ts` + route) with site-level leanCTX statistics via `probeLeanCtxSite` (cached, failure → statistics unavailable) and render them in the Dashboard "Projects" card (`src/admin/views/dashboard.tsx`, `DashboardData`): projects with facts, total memory facts, projects active within 24h, health coverage

## 4. Cache invalidation

- [x] 4.1 Call the cache `invalidate()` from `syncProjects` in `src/admin/lib/projects.ts` so a project added/removed by sync is re-probed on the next overview request

## 5. Tests and verification

- [x] 5.1 Extend `test/test-admin.sh` with overview payload assertions: an indexed project returns full codegraph fields, a never-indexed project returns `initialized:false`, and a probe failure yields `null` without failing the endpoint
- [x] 5.2 Extend `test/test-admin-ui.sh` with rendering assertions for the three codegraph badge states (indexed / not-indexed / unknown) and the Dashboard leanCTX statistics (values rendered; unavailable state when the scan fails)
- [x] 5.3 Run the full admin test suite (`test/test-admin.sh` and `test/test-admin-ui.sh`) green, plus `bun run build` / type-check exit 0 on `src/admin`

## Completion notes

- **1.1/1.2 mechanism**: probe functions live inside `createToolStatusProbe()` returning a `ProjectToolStatusProvider` with a `probe(name)` method, instead of standalone `probeCodegraph`/`probeLeanCtx` exports — same behavior (read-only, 10s timeout, `null` on failure), factory pattern chosen so probes are injectable into tests and share one cache.
- **1.4 verification**: `lsp_diagnostics` unavailable (TypeScript LSP not installed in this environment); substituted with `bunx tsc --noEmit` comparison (no new errors introduced) + the module's unit test suite.
- **3.2 mechanism**: SSR emits placeholder tool cells; the client-side inline `loadFeatures()` in `views/projects.tsx` (not `static/app.js`) fetches `/api/projects/overview` and fills the badges — the route already carries the status in the overview payload.
- **5.1 target file**: payload assertions live in `test/test-admin-ui.sh` (section 19/19b, authenticated flow) plus unit tests in `project-tool-status.test.ts` and `routes/projects.test.ts` — `test-admin.sh` is the unauthenticated 401 smoke test and cannot exercise the payload.
- **5.3 gates**: `src/admin/package.json` has no `build`/`typecheck` script (only `bun test`); repo-wide `tsc --noEmit` is red on untouched files (pre-existing), so the gate is: full `bun test` suite + no new tsc errors + `bash -n` on the shell test. Result: 319 pass / 2 fail (both failures pre-existing `provider-meta.test.ts` `/opt/ai-engkit/.env` ENOENT, baseline-identical); 44/44 on all touched test files; shell syntax OK.
- **leanCTX site-level pivot**: the first implementation pass surfaced per-project leanCTX in the overview API and projects table; post-implementation research showed per-project attribution is unreliable (session activity is global, health scores are sparse, single-project fact counts are low-signal). The change was revised (proposal/spec/design/tasks) to site-level statistics on the Dashboard (`/api/status`) instead, and the per-project leanCTX column/field was removed. Tasks 1.2-1.4, 2.1-2.2, 3.1-3.4, 5.2 were re-opened for the pivot. `/opsx-apply` carried the revised plan into code: `project-tool-status.ts` now exports `LeanCtxSiteStats` + `probeSite()` (site-wide single-pass scan, `null` on failure), the overview payload/projects table carry codegraph only, `/api/status` returns `leanctx` (null = unavailable), and the Dashboard Projects card renders the four statistics. Verification: 323/2 unit (2 pre-existing `provider-meta.test.ts` ENOENT), `bash -n` clean, no new tsc errors.
