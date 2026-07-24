## Context

The ai-admin dashboard Versions page (`/versions`) currently renders a flat table of 11 components. The Dockerfile installs 18 tools with pinned versions, but only 10 are actually displayed (Node shows "unavailable"). The version data is fetched via server-side self-fetch to `/api/versions` which runs shell commands in the ai-dev container via Docker socket.

Current `/api/versions` response:
```json
{
  "OpenCode": "1.18.4",
  "OpenChamber": "1.16.3",
  "Bun": "1.3.14",
  ...
}
```

## Goals / Non-Goals

**Goals:**
- Display all 18 Dockerfile-installed tools with correct versions
- Organize tools into 4 architectural categories: Core, CLI, MCP, Plugin
- Each category renders as a separate card with section header
- Version extraction works reliably in both ai-dev and ai-admin containers

**Non-Goals:**
- Real-time version checking (versions are read at request time, not cached)
- Adding/removing tools from the Dockerfile
- Changing the admin dashboard layout or navigation

## Decisions

### D1: API response structure — grouped object

**Decision:** Change `/api/versions` from flat map to grouped structure:
```json
{
  "core": { "Bun": "1.3.14", "Docker": "29.6.2", ... },
  "cli": { "OpenCode": "1.18.4", "gh": "2.96.0", ... },
  "mcp": { "Playwright MCP": "0.0.78" },
  "plugin": { "superpowers": "6.2.0", "oh-my-openagent": "4.19.1" }
}
```

**Rationale:** Frontend needs category data for rendering. Putting it in the API avoids duplicating category logic in the view. Flat map would require the view to know which tools belong to which category.

**Alternative considered:** Keep flat map, add category metadata separately. Rejected: adds unnecessary complexity.

### D2: Version commands — container-aware

**Decision:** Each tool uses a version command that works in the sidecar container:

| Tool | Command | Notes |
|------|---------|-------|
| Bun | `bun --version` | Direct |
| Docker | `docker --version \| cut -d' ' -f3 \| tr -d ','` | Existing |
| Docker Compose | `docker compose version --short` | Existing |
| Docker Buildx | `docker buildx version 2>/dev/null \| sed 's/.*v//'` | New |
| OpenCode | `opencode --version` | Existing |
| OpenChamber | `/home/devuser/.bun/bin/openchamber --version` | Fixed path |
| gh | `gh --version \| head -1 \| cut -d' ' -f3` | Existing |
| glab | `glab --version \| cut -d' ' -f2` | Fixed field |
| Git | `git --version \| cut -d' ' -f3` | Existing |
| lean-ctx | `lean-ctx --version` | Existing |
| Playwright | `bunx playwright --version \| sed 's/^Version //'` | Fixed: use bunx |
| marksman | `marksman --version` | New |
| codegraph | `codegraph --version` | New |
| openspec | `openspec --version` | New |
| Playwright MCP | `pw-mcp --version \| sed 's/^Version //'` | New |
| superpowers | `jq -r .version /opt/opencode/baked-plugins/superpowers/package.json` | New |
| oh-my-openagent | `bunx oh-my-openagent --version` | New |

**Rationale:** Each command is tested in the actual container. bunx is used for tools installed via bunx (Playwright, oh-my-openagent). Package.json is used for git-cloned plugins without CLI version flags.

### D3: Remove Node.js

**Decision:** Remove Node from the version display entirely.

**Rationale:** The container only has a bun symlink (`ln -sf bun → node`). `node --version` returns bun's error message, not a version. Displaying "unavailable" is confusing — it implies Node should be there but isn't working. Since Bun IS the JavaScript runtime, showing Node is misleading.

### D4: View layout — card grid per category

**Decision:** Render 4 cards in a 2-column grid layout:
```
┌─────────────────────┐ ┌─────────────────────┐
│  Core               │ │  CLI                │
│  Bun     1.3.14     │ │  OpenCode  1.18.4   │
│  Docker  29.6.2     │ │  gh        2.96.0   │
│  ...                │ │  ...                │
└─────────────────────┘ └─────────────────────┘
┌─────────────────────┐ ┌─────────────────────┐
│  MCP                │ │  Plugin             │
│  Playwright MCP     │ │  superpowers 6.2.0  │
│       0.0.78        │ │  oh-my-openagent    │
└─────────────────────┘ └─────────────────────┘
```

**Rationale:** Matches existing card pattern in the dashboard. Categories are visually distinct. Empty categories (MCP has only 1 tool) still show for consistency.

## Risks / Trade-offs

- **[Breaking API]** → `/api/versions` response shape changes. Any external consumers (scripts, tests) using the flat map will break. Mitigation: only internal UI consumes this endpoint.
- **[Version command failures]** → Some tools may not be installed in all environments (e.g., Buildx in ai-admin). Mitigation: each command has `|| echo 'unavailable'` fallback.
- **[Server-side self-fetch cookie forwarding]** → The `/versions` page route does internal fetch to `/api/versions`. Already fixed to forward session cookie.
