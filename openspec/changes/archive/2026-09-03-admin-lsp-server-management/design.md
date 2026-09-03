## Context

Currently the only baked-in LSP is `marksman` (pinned in the Dockerfile and emitted into the generated `opencode.json` `lsp` block by `entrypoint.d/02-init-config.sh`). Everything else must be hand-installed through free-text `.env` vars (`BUN_PACKAGES` / `APT_PACKAGES` / `BREW_PACKAGES`), consumed at startup by `entrypoint.d/01-install-packages.sh`. The Admin (a Bun/Hono server in `src/admin/`) already manages several declarative-reconciled configs: agent models (`lib/agent-model-reconciler.ts`), LeanCTX (`routes/leanctx.ts` + `lib/leanctx.ts` + an applied-snapshot contract), and OpenChamber projects. It can exec into the ai-dev container via `lib/docker.ts` `execInAiDev`, read/write/enumerate `.env` via `lib/env.ts`, and generate structured config. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- A structured, Admin-page-managed catalog of OpenCode-facing bun/npm LSP servers, with per-server enable toggles and npm-version-based pinning.
- Version discovery and selection backed by the live npm registry (analogous to `lib/ghcr-versions.ts` for GHCR, but npm-registry is simpler: one JSON document, no token/pagination).
- Persistence as image-baseline + user-override, with container lifecycle preserving overrides (mirrors the LeanCTX contract).
- An on-demand reconcile that reconciles desired catalog against installed/config state and reports a summary. Observed state is read live on each page load (`bun pm ls -g` + the generated `opencode.json` `lsp` block); no separate applied snapshot is stored.
- Reuse existing mechanisms: `BUN_PACKAGES` install path + generated `opencode.json` `lsp` block. No new install framework.

**Non-Goals:**
- Managing non-OpenCode LSP servers (e.g. CLI-only tools) — only servers that appear in the `opencode.json` `lsp` block are controlled.
- apt/brew-installed LSP servers — scope is bun/npm only for now.
- Auto-installing LSPs without an explicit operator apply action (no surprise installs at startup beyond what `.env` already triggers).
- Per-project LSP overrides (the existing `lsp.json` project merge stays as-is; this change manages the global opencode `lsp` block).

## Decisions

### D1. Catalog is a static code module, not a new data store
Define supported LSPs as a typed, versioned array in `src/admin/lib/lsp-catalog.ts`. Rationale: it is known/shipped with the image (realize the "image baseline" requirement), it is easy to test, and it needs no persistence layer. Alternatives considered: a versioned JSON file on disk (rejected — image should own the baseline; user overrides belong in `.env`), and a dynamic registry probe (rejected — needs network to even render the page).

Each entry carries the server's id (the `lsp` block key), the npm package that provides its binary, the launch argv, and the extensions it serves. The initial catalog, with package names/binaries/commands verified against the live npm registry and OpenCode's own `lsp/server.ts` source:

| id | npmPackage (binary) | command | extensions |
|---|---|---|---|
| typescript | `typescript-language-server` | `["typescript-language-server","--stdio"]` | `.ts .tsx .js .jsx .mjs .cjs .mts .cts` |
| vue | `@vue/language-server` (bin `vue-language-server`) | `["vue-language-server","--stdio"]` | `.vue` |
| json | `vscode-langservers-extracted` (bin `vscode-json-language-server`) | `["vscode-json-language-server","--stdio"]` | `.json .jsonc` |
| css | `vscode-langservers-extracted` (bin `vscode-css-language-server`) | `["vscode-css-language-server","--stdio"]` | `.css .scss .less` |
| html | `vscode-langservers-extracted` (bin `vscode-html-language-server`) | `["vscode-html-language-server","--stdio"]` | `.html .htm` |
| yaml | `yaml-language-server` | `["yaml-language-server","--stdio"]` | `.yaml .yml` |
| dockerfile | `dockerfile-language-server-nodejs` (bin `docker-langserver`) | `["docker-langserver","--stdio"]` | `.dockerfile` `Dockerfile` |
| biome | `@biomejs/biome` (bin `biome`) | `["biome","lsp-proxy","--stdio"]` | `.ts .tsx .js .jsx .mjs .cjs .mts .cts .json .jsonc .vue .astro .svelte .css .graphql .gql .html` |

Notes that shape the design:
- `typescript`, `vue`, `yaml`, `biome` are OpenCode **built-ins** that OpenCode already auto-installs on demand; the feature's value for them is the explicit toggle + version pin + observed-version visibility. `json`/`css`/`html`/`dockerfile` are **custom** servers that only take effect when their entry is present in the `lsp` block.
- Several npm packages expose **multiple** LSP binaries (`vscode-langservers-extracted` → json/css/html). The install step must dedupe packages: derive a unique set of `npmPackage`s from the enabled rows, not one install per row.
- All `--stdio` servers need `--stdio` (except biome uses `lsp-proxy --stdio`); the catalog hardcodes the correct argv so the UI never hand-edits commands.
- JSON/CSS/HTML may overlap with Biome's extension set; OpenCode resolves multiple servers for the same extension, so this is allowed.

```ts
{
  id: "typescript",
  serverKey: "typescript",               // id is also the lsp block key
  npmPackage: "typescript-language-server",
  command: ["typescript-language-server", "--stdio"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  builtin: true,                         // OpenCode knows this server natively
  defaultEnabled: false,
}
```

### D2. User overrides live in `.env` as a structured JSON var; install rides `BUN_PACKAGES`
Persist overrides in `.env` under a single structured variable, e.g. `LSP_SERVERS` (JSON `{ "<id>": { "enabled": bool, "version": string|null } }`), via the existing `lib/env.ts` read/write. This keeps overrides in the same persisted location as every other Admin-managed variable.

When the operator saves, the Admin derives the `BUN_PACKAGES` value to include `<npmPackage>@<version>` (or `<npmPackage>` when unpinned) for every enabled, unpinned-latest or pinned server, deduped by package (one `vscode-langservers-extracted` entry serves json/css/html), and writes it back through `lib/env.ts`. That flows through the existing `01-install-packages.sh` on the next container start. Rationale: zero changes to the install framework while getting pinning for free from bun's `@version` support.

Alternative considered: a dedicated `bun install -g` invocation via `execInAiDev` on every apply. Kept as the on-demand apply path (see D4) so an operator can reconcile without a full container restart, but the durable/lifecycle-surviving path is `BUN_PACKAGES`.

### D3. The catalog plus user overrides is the source of truth; the `lsp` block is a product
The controlled set is defined by which catalog entries are enabled through `LSP_SERVERS` (this is what the Admin page and reconciler reason about). `02-init-config.sh` continues to emit `marksman` (a baked image baseline, always on and outside the catalog) and additionally emits the enabled catalog LSPs (id → `{ command, extensions }`) into the `lsp` block it already generates. Because `typescript`/`vue`/`yaml`/`biome` are OpenCode built-ins that take effect even when absent from the `lsp` block, the Admin reads *both* the catalog enablement and the live installed version (via `execInAiDev`) to report the effective state — it does not treat the `lsp` block as the definition of control. Rationale: keeps the definition honest (built-ins still "controlled" when enabled) and avoids the impossible guarantee that every enabled server appears verbatim in the generated block.

### D4. Reconcile is an on-demand Admin action over live observed state
A `lib/lsp-reconciler.ts` (modeled on `lib/agent-model-reconciler.ts`'s structure) computes desired (catalog + overrides) vs. observed, where observed is read live: installed versions from a `bun pm ls -g`-style parse, and the config product from the generated `lsp` block. On operator apply it:
1. writes `LSP_SERVERS` + `BUN_PACKAGES` to `.env`,
2. runs `bun install -g` for changed servers via `execInAiDev` (immediate apply without full restart),
3. reports a summary of changed / applied / failed.

No snapshot is stored or tracked; the page simply re-reads observed state on each load, so "saved vs. applied" is not distinguished (out of scope for v1 — the durable install path is `BUN_PACKAGES` on the next container start, and any saved change is reflected whenever the operator applies or restarts).

### D5. Version discovery is a thin npm-registry lib
`lib/npm-versions.ts` fetches `https://registry.npmjs.org/<package>` once with a short TTL cache (mirroring `ghcr-versions.ts`'s 5-min cache), extracts published versions, sorts newest-first, and returns them with a `latest` marker. No auth, no pagination required for these packages. Rationale: simpler than the GHCR path and gives exact published versions for the dropdown. Registry unreachable → actionable error, no auto-guess.

### D6. Admin surface is a new Hono route + view
`routes/lsp.ts` (page + JSON API: list catalog with observed state, `GET` versions, `PUT` overrides, `POST` reconcile/apply) and `views/lsp.tsx` (a table per catalog row: enable toggle, version dropdown + pin, observed version, "upgrade to latest" / "apply" actions). Registered in `server.ts` under the same auth guard as other routes. Follows `leanctx-admin-config` and `env-editor` patterns.

## Risks / Trade-offs

- [Catalog drift vs. upstream] LSP npm packages change commands/extensions over time → keep the catalog in the image; a future version bump updates it; the CLI command in catalog is verified from npm at authoring time.
- [Built-in servers auto-installed by OpenCode] OpenCode auto-installs `typescript`/`vue`/`yaml`/`biome` on demand, which could install a different version than the operator pinned → the reconciler's observed-state check reports the actual installed version and flags the mismatch; pinning still works because a global `bun install -g pkg@version` wins for the launched binary.
- [Shared package across servers] `vscode-langservers-extracted` backs three rows → installation must dedupe by package (D2), and enabling two of json/css/html must not install the package twice.
- [Reconcile installs visible to running OpenCode sessions] `bun install -g` mutates the shared toolchain → run it only on explicit operator apply, and report failures without corrupting `.env` (write `.env` only after a successful install, or restore on failure — see spec failure scenarios).
- [opencode.json is regenerated at startup] any hand edit to its `lsp` block would be overwritten next start → this feature is the managed owner of the generated `lsp` block, while control itself is defined by catalog enablement (D3); acceptable and consistent with how plugin/MCP blocks are already regenerated.
- [npm registry availability] Admin page and version dropdown need outbound network → degrade to cached/installed state with an actionable error, never fail the whole page.

## Migration Plan

- No data migration: `LSP_SERVERS` is new and defaults to "all disabled / unpinned"; `marksman` behavior is unchanged.
- Rollback: remove `LSP_SERVERS` from `.env` and revert the `02-init-config.sh` lsp-block extension; existing `BUN_PACKAGES` semantics are untouched, so disabling the feature leaves the old free-text path intact.

## Open Questions

- None. The catalog members and their npm package names/binaries/commands were verified against the live npm registry and OpenCode source (see Decisions → D1); these are fixed in the catalog module rather than left to guessing.
