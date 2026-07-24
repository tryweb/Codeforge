## Why

The Versions page in ai-admin dashboard currently shows a flat list of 11 tools, missing 7 tools that are installed via Dockerfile (Buildx, Playwright MCP, marksman, codegraph, openspec, superpowers, oh-my-openagent). Node.js is displayed as "unavailable" despite being a bun symlink wrapper that doesn't support standalone `--version`. The flat list doesn't convey the architectural role of each tool, making it hard for users to understand what's installed and why.

## What Changes

- **Remove** Node.js from the version display (bun wrapper, no standalone version)
- **Add** 7 missing tools: Docker Buildx, Playwright MCP, marksman, codegraph, openspec, superpowers, oh-my-openagent
- **Categorize** all tools into 4 groups: Core, CLI, MCP, Plugin
- **Update** `/api/versions` to return grouped data structure instead of flat map
- **Redesign** `versions.tsx` to render categorized cards with section headers
- **Fix** version extraction for Playwright (use `bunx` not `npx`) and OpenChamber (use bun binary not missing version.txt)

## Capabilities

### New Capabilities
- `categorized-versions`: Display tools in architectural categories (Core, CLI, MCP, Plugin) with correct version extraction for all Dockerfile-installed tools

### Modified Capabilities

## Impact

- `src/admin/routes/versions.ts` — API response structure changes from flat to grouped
- `src/admin/views/versions.tsx` — View renders categorized cards instead of single table
- Breaking: any consumer relying on flat `/api/versions` response shape
