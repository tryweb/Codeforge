## Why

AI-EngKit ships only `marksman` as a baked LSP; every other language server must be installed manually. Today that happens through free-text `.env` variables (`BUN_PACKAGES`, `APT_PACKAGES`, `BREW_PACKAGES`) that carry no structure: there is no way for an operator to see which LSP servers are installed, which versions they run, whether a pinned version is out of date, or to install/upgrade/pin one from the Admin UI. The result is a fragile, error-prone setup that differs per environment and cannot be managed consistently.

This change gives operators a structured, Admin-managed way to control the LSP servers that OpenCode actually uses, with version discovery, version pinning, and reconciliation — matching the declarative-reconcile philosophy already used for agent models, LeanCTX, and OpenChamber projects.

## What Changes

- Introduce a structured **LSP catalog** of the OpenCode-facing (opencode.json `lsp` block) bun/npm-installable language servers that AI-EngKit supports out of the box (e.g. TypeScript, Vue, JSON/CSS/HTML, YAML, Dockerfile, Biome).
- Add a new **Admin LSP page** that lists each catalog LSP with its install state (installed / missing / version-mismatch), an `enabled` toggle, and a version control backed by live **npm registry discovery** (dropdown of published versions, plus a pin/lock and an "upgrade to latest" action).
- Persist the operator's overrides in an **image-baseline + user-override** model (mirroring the existing LeanCTX contract): the Docker image provides defaults, the Admin writes user overrides, and container lifecycle preserves them.
- Wire management to the two existing runtime mechanisms instead of new infrastructure:
  - **Installation** flows through the existing `01-install-packages.sh` `BUN_PACKAGES` path (pin via `pkg@version`).
  - **Configuration** flows through the existing generated `opencode.json` `lsp` block in `02-init-config.sh`, with the Admin-managed catalog as its source.
- Add an **LSP reconcile** step (desired catalog vs. observed install/config) available on demand from the Admin UI, reported with a summary (same shape as the existing agent-model reconciler). Observed state is re-read live on each page load, so no separate applied-snapshot file is kept.

No changes to the container install/runtime frameworks themselves.

## Capabilities

### New Capabilities
- `admin-lsp-config`: structured, Admin-managed configuration of OpenCode-facing LSP servers — catalog of supported servers, per-server enable/disable, npm version discovery and pinning, install/upgrade/reconcile actions, and image-baseline + user-override persistence tied to the generated opencode.json `lsp` block.

### Modified Capabilities
- (none — this introduces a new capability; the existing `leanctx-admin-config`, `admin-agent-model-config`, and `admin-upgrade-version-selection` specs are unchanged)

## Impact

- **Admin UI**: new `routes/lsp.ts` (or `lib/lsp.ts` + route), `views/lsp.tsx`, and `static` wiring; new npm version-discovery lib modeled on `lib/ghcr-versions.ts`.
- **Admin lib**: new `lib/lsp-catalog.ts` (supported LSP definitions), `lib/lsp-reconciler.ts` (desired-vs-observed), reuse of `lib/env.ts` (`BUN_PACKAGES`, `LSP_SERVERS`), and `lib/docker.ts` (`execInAiDev`).
- **entrypoint**: `02-init-config.sh` extends the generated `opencode.json` `lsp` block to include enabled catalog LSPs instead of only `marksman`; `01-install-packages.sh` already consumes `BUN_PACKAGES` unchanged.
- **Dependencies**: none new at runtime — bun `install -g` is already present; npm registry reachable from the container.
- **Tests**: new unit tests for catalog schema, version discovery, lsp-block generation, and the reconciler; Admin e2e coverage for the LSP page lifecycle.
