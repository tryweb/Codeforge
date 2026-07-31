## 1. Empirical verification (prerequisite)

- [x] 1.1 Read the live `~/.local/share/opencode/auth.json` in the dev ai-dev container and record the exact `opencode-go` entry shape (`docker exec ai-engkit-dev cat ...` + `jq`); note sibling fields that must be preserved on write
- [x] 1.2 Confirm `~/.cache/oh-my-opencode/{connected-providers,provider-models,model-capabilities}.json` exist in ai-dev and that `docker restart ai-dev` restarts the opencode server while `auth.json` persists in the `opencode-config` volume

## 2. Key registry library

- [x] 2.1 `src/admin/lib/provider-keys.ts`: typed read/write of `/opt/ai-engkit/provider-keys.json` (auto-create, `0600`, atomic write), dual-mode path reuse from `env.ts`
- [x] 2.2 Registry helpers: addKey / deleteKey / setActive (with next-key promotion rule) / list with masked last-4 identifiers

## 3. Providers API

- [x] 3.1 `src/admin/routes/providers.ts` `GET /api/providers`: parse `OPENCODE_PROVIDER`, return provider metadata + key registry summary, no plaintext values
- [x] 3.2 `PUT /api/providers/:name`: validate provider shape, upsert into `OPENCODE_PROVIDER` via `upsertEnvVar`; 400 on invalid JSON/shape with `.env` untouched
- [x] 3.3 `DELETE /api/providers/:name`: remove provider; drop `OPENCODE_PROVIDER` entirely when last provider deleted; 404 for unknown names
- [x] 3.4 `GET /api/providers/:name/keys/:keyId/value`: reveal single plaintext key (on-demand)
- [x] 3.5 `POST /api/providers/:name/keys` and `DELETE /api/providers/:name/keys/:keyId`: registry add/delete with active-key promotion
- [x] 3.6 `PUT /api/providers/:name/keys/:keyId/active`: persist selection; trigger apply sequence for `opencode-go`; error path returns apply failure
- [x] 3.7 `GET /api/providers/:name/keys/import-candidate` + `POST /api/providers/:name/keys/import`: first-run import of existing `auth.json` key (only offered when registry empty for that provider)
- [x] 3.8 Add JSON validation to env editor `PUT /api/env/:key` when key is `OPENCODE_PROVIDER`

## 4. Active-key apply mechanism

- [x] 4.1 `src/admin/lib/opencode-auth.ts`: docker exec read-modify-write of `auth.json` setting `opencode-go.key` via jq (preserve sibling providers, never echo key to logs)
- [x] 4.2 Cache clear helper: delete the three `~/.cache/oh-my-opencode/*.json` files via docker exec
- [x] 4.3 Wire apply sequence (auth.json write → cache clear → existing restart helper) with failure reporting back to the API

## 5. Providers UI

- [x] 5.1 `src/admin/views/providers.tsx`: Secrets-style provider cards (masked key placeholder, Show/Edit, raw-JSON fallback modal), API Keys section (add/delete, active radio, import action), restart-required note + existing restart flow
- [x] 5.2 Register `/providers` route in `src/admin/server.ts` and add nav entry in `views/layout.tsx`
- [x] 5.3 Add any needed `static/style.css` additions (reuse existing card/modal/badge/masked classes)

## 6. Compose and docs

- [x] 6.1 `docker-compose.yml`: bind-mount `./provider-keys.json:/opt/ai-engkit/provider-keys.json:rw` into admin service (prod only)
- [x] 6.2 README: document the Providers page and `provider-keys.json`; confirm `.env.example` unchanged (no new env vars)

## 7. Tests

- [x] 7.1 Extend `test/test-admin-ui.sh`: provider CRUD, 400 validation, masked list (no plaintext in list response), key add/delete/promotion, active selection, import candidate
- [x] 7.2 Integration test on dev stack: apply sequence updates `auth.json`, clears cache, restarts server; unreachable-container path returns apply error
- [x] 7.3 Run full integration: `docker compose` v2 build + `up -d` + `run-tests.sh ai-engkit-dev` green (safe variant of `test/test-full.sh`: no `down -v`, no `--no-cache`, services left running; script itself requires v1 CLI)
