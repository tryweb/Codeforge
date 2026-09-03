## 1. Catalog & Version Discovery

- [x] 1.1 Add `src/admin/lib/lsp-catalog.ts` defining the typed catalog of 8 LSP entries (typescript, vue, json, css, html, yaml, dockerfile, biome) with serverKey, npmPackage, command argv (incl. `--stdio`/`lsp-proxy --stdio`), extensions, builtin flag, and default `defaultEnabled:false` — verify with `bun test` on a small `lsp-catalog.test.ts` asserting the npm/exe name map (esp. `@vue/language-server`→`vue-language-server`, `dockerfile-language-server-nodejs`→`docker-langserver`, and the shared `vscode-langservers-extracted`).
- [x] 1.2 Add `src/admin/lib/npm-versions.ts` with a TTL-cached `discoverNpmVersions(packageName)` that fetches `https://registry.npmjs.org/<pkg>`, returns published versions newest-first with the latest marked, and rejects with a typed error on registry failure — verify its unit test covers success, sort order, and unreachable-registry error without hanging.

## 2. Overrides & lsp-block Generation

- [x] 2.1 Add a `LSP_SERVERS` parse/serialize helper (JSON `{ "<serverKey>": { enabled, version|null } }`) over `lib/env.ts`, respecting image-baseline default (no `LSP_SERVERS` ⇒ all disabled/unpinned) — verify `lib/lsp-config.test.ts` covers parse, serialize, merge-with-default, and malformed-JSON fallback.
- [x] 2.2 Extend `entrypoint.d/02-init-config.sh` to generate the `opencode.json` `lsp` block from enabled `LSP_SERVERS` (id → `{ command, extensions }`) in addition to `marksman`, deduping by npmPackage, and omit disabled servers — verify `test-admin.sh`/`test-full.sh` asserts the emitted `lsp` block contains exactly the enabled entries.

## 3. Reconciler & Apply

- [x] 3.1 Add `src/admin/lib/lsp-reconciler.ts` (modeled on agent-model-reconciler) computing desired (catalog + `LSP_SERVERS`) vs. observed (live: parse `bun pm ls -g` for installed versions, read generated `opencode.json` `lsp` block for config), producing a summary `{ changed, applied, failed, results }` — verify `lib/lsp-reconciler.test.ts` covers no-op, enable-adds-entry, version-mismatch, and missing-package cases.
- [x] 3.2 Add reconcile apply: write `LSP_SERVERS`+`BUN_PACKAGES` to `.env` only after the install step succeeds (on failure restore prior `.env`), and run deduped `bun install -g <pkg>@<ver>` via `execInAiDev` for changed servers — verify tests cover install-success, install-failure-preserves-env (no corrupt `.env`), and package dedup.

## 4. Admin Route, View & Wiring

- [x] 4.1 Add `src/admin/routes/lsp.ts` with JSON API (`GET /api/lsp` catalog+observed, `GET /api/lsp/versions?package=`, `PUT /api/lsp` bulk overrides, `POST /api/lsp/apply`) and `GET /lsp` page route, registered in `server.ts` under the existing auth guard — verify `routes/lsp.test.ts` passes (12 tests) and route is mounted after `authGuard`.
- [x] 4.2 Add `src/admin/views/lsp.tsx` rendering a per-server table (enable toggle, version dropdown from discovered versions, observed/installed version, Apply Changes action) following the leanctx/env-editor UI patterns — verify `GET /lsp` renders rows for all 8 catalog entries and the page is reachable from the sidebar nav.
- [x] 4.3 Add incremental reveal for long version lists (newest 10 + "More"), matching the upgrade page's incremental version reveal — verify the version dropdown shows the newest 10 by default and expands via "Show more".

## 5. Tests, Docs & Validation

- [x] 5.1 Add e2e coverage in `e2e/lsp.spec.ts` (admin-p1-p2 style) for the LSP page lifecycle: list, toggle, pin, apply, and reconcile flow — spec collects cleanly (2 tests); run against a running Admin via `test-full.sh` in 5.3.
- [x] 5.2 Update `docs/ARCHITECTURE.md` and `docs/TOOLING.md` describing the catalog, `LSP_SERVERS` var, and reconcile model — added "LSP Server Management" subsection to ARCHITECTURE.md + feature-table row, and a runtime-extension note in TOOLING.md; markdown links intact.
- [x] 5.3 Run `bun test` in `/opt/admin`, the entrypoint tests, and `openspec validate` — `bun test` (src/admin) passes 878/878; `entrypoint.d/02-init-config.test.sh` passes (exit 0); `bash -n` clean on `02-init-config.sh` + `01-install-packages.sh`; `openspec validate --changes admin-lsp-server-management` passes (1/1). NOTE: the full `test-full.sh` destroy/rebuild integration was NOT run — it issues `docker-compose down -v` (wipes live volumes) and the running `ai-engkit-admin` serves pre-change code.
