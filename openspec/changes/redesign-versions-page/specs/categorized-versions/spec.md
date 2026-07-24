## ADDED Requirements

### Requirement: API returns grouped version data
The `/api/versions` endpoint SHALL return a JSON object with 4 category keys (`core`, `cli`, `mcp`, `plugin`), each containing a map of tool names to version strings.

#### Scenario: All categories present
- **WHEN** client requests `GET /api/versions` with valid session cookie
- **THEN** response body contains keys `core`, `cli`, `mcp`, `plugin` each with at least one entry

#### Scenario: Version strings are non-empty
- **WHEN** client requests `GET /api/versions`
- **THEN** every version value is a non-empty string (tools without available versions use `"unavailable"`)

### Requirement: Core category contains runtime and container tools
The `core` category SHALL contain: Bun, Docker, Docker Compose, Docker Buildx.

#### Scenario: Core tools present
- **WHEN** client requests `GET /api/versions`
- **THEN** `core` object contains keys `Bun`, `Docker`, `Docker Compose`, `Docker Buildx`

### Requirement: CLI category contains developer tools
The `cli` category SHALL contain: OpenCode, OpenChamber, gh, glab, Git, lean-ctx, Playwright, marksman, codegraph, openspec.

#### Scenario: CLI tools present
- **WHEN** client requests `GET /api/versions`
- **THEN** `cli` object contains keys `OpenCode`, `OpenChamber`, `gh`, `glab`, `Git`, `lean-ctx`, `Playwright`, `marksman`, `codegraph`, `openspec`

### Requirement: MCP category contains Model Context Protocol servers
The `mcp` category SHALL contain: Playwright MCP.

#### Scenario: MCP tools present
- **WHEN** client requests `GET /api/versions`
- **THEN** `mcp` object contains key `Playwright MCP`

### Requirement: Plugin category contains OpenCode extensions
The `plugin` category SHALL contain: superpowers, oh-my-openagent.

#### Scenario: Plugin tools present
- **WHEN** client requests `GET /api/versions`
- **THEN** `plugin` object contains keys `superpowers`, `oh-my-openagent`

### Requirement: Node.js is excluded
The version display SHALL NOT include Node.js.

#### Scenario: Node not in any category
- **WHEN** client requests `GET /api/versions`
- **THEN** no category contains a key named `Node`

### Requirement: Versions page renders categorized cards
The `/versions` page SHALL render 4 separate cards, one per category, each with a section header and a table of tool names and versions.

#### Scenario: Page renders all categories
- **WHEN** authenticated user visits `/versions`
- **THEN** page contains sections labeled "Core", "CLI", "MCP", "Plugin"

#### Scenario: Empty categories still render
- **WHEN** a category has only one tool (e.g., MCP)
- **THEN** the category card still renders with that single tool

### Requirement: Version extraction uses container-compatible commands
Each tool's version SHALL be extracted using commands that work in the ai-admin sidecar container (bun-based, no npx, no standalone node).

#### Scenario: Playwright version via bunx
- **WHEN** version extraction runs for Playwright
- **THEN** command uses `bunx playwright --version` (not `npx`)

#### Scenario: OpenChamber version via bun binary
- **WHEN** version extraction runs for OpenChamber
- **THEN** command uses `/home/devuser/.bun/bin/openchamber --version` (not missing version.txt)

#### Scenario: oh-my-openagent version via bunx
- **WHEN** version extraction runs for oh-my-openagent
- **THEN** command uses `bunx oh-my-openagent --version`

#### Scenario: superpowers version from package.json
- **WHEN** version extraction runs for superpowers
- **THEN** command reads `/opt/opencode/baked-plugins/superpowers/package.json` for version field
