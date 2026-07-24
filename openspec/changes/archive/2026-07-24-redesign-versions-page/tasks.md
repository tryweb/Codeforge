## 1. API — Version Commands

- [x] 1.1 Update `/api/versions` in `src/admin/routes/versions.ts` to return grouped structure with keys `core`, `cli`, `mcp`, `plugin`
- [x] 1.2 Add version commands for new tools: Docker Buildx, marksman, codegraph, openspec, Playwright MCP, superpowers, oh-my-openagent
- [x] 1.3 Remove Node.js from version commands
- [x] 1.4 Fix OpenChamber version command: use `/home/devuser/.bun/bin/openchamber --version`
- [x] 1.5 Fix glab version extraction: `cut -d' ' -f2` instead of `-f3`
- [x] 1.6 Fix Playwright version command: use `bunx playwright --version` with `sed 's/^Version //'`

## 2. View — Categorized Rendering

- [x] 2.1 Update `src/admin/views/versions.tsx` to accept grouped data structure
- [x] 2.2 Render 4 category cards: Core, CLI, MCP, Plugin with section headers
- [x] 2.3 Each card shows tool name and version in a table

## 3. Server-Side Fetch

- [x] 3.1 Update `/versions` route to pass grouped data to the view
- [x] 3.2 Verify session cookie forwarding works with new API response shape

## 4. Verification

- [x] 4.1 Test `/api/versions` returns all 18 tools across 4 categories
- [x] 4.2 Test `/versions` page renders all categories with correct data
- [x] 4.3 Test version extraction for each new tool in ai-admin container
