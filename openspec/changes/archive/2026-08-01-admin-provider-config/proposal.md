## Why

Provider configuration today lives as a raw single-line JSON env var (`OPENCODE_PROVIDER`) that users must hand-edit in the env editor's unvalidated textarea. API keys for connected providers (e.g. the oh-my-openagent plugin's `opencode-go` tier) live in opencode's auth store (`~/.local/share/opencode/auth.json`), invisible to admin and impossible to rotate or select from the dashboard.

## What Changes

- New admin **Providers** page (`/providers`) + `/api/providers` API: structured form over `OPENCODE_PROVIDER` with per-provider cards (name, npm package, baseURL, masked API key) plus a per-provider raw-JSON fallback for complex fields (models, options). Saves back to `OPENCODE_PROVIDER` as single-line JSON with validation; changes require a container restart to apply (entrypoint regenerates `opencode.json` at boot). Adds provider removal (DELETE), which the env editor lacks.
- New **provider API key registry**: `/opt/ai-engkit/provider-keys.json` (bind-mounted in production alongside `.env`, container-local in dev). Stores a list of keys per provider plus the active selection. Keys are never stored in `.env` (avoids `docker inspect` exposure and the dev-mode env-apply limitation).
- **Active key application** for `opencode-go` (first provider): selecting a key writes it into the ai-dev container's `~/.local/share/opencode/auth.json` via docker exec, clears the oh-my-opencode provider cache, and restarts the opencode server.
- **First-run migration**: an existing `opencode-go` key in `auth.json` is imported as registry key #1 (active) so existing deployments are not disrupted.
- Env editor remains as-is (raw fallback); `OPENCODE_PROVIDER` stays the source of truth for provider definitions.

## Capabilities

### New Capabilities

- `admin-provider-config`: Admin UI/API for managing AI provider definitions backed by the `OPENCODE_PROVIDER` env var — structured editing, validation, deletion, and restart semantics.
- `provider-api-key-registry`: Per-provider multi-key storage with manual active-key selection, and application of the active key to the running opencode auth store.

### Modified Capabilities

<!-- None: existing specs (omo-config-persistence, omo-unified-config) are unaffected. -->

## Impact

- **src/admin/**: new `routes/providers.ts`, `views/providers.tsx`, `lib/provider-keys.ts` (registry read/write); `routes/env.ts` gains JSON validation for `OPENCODE_PROVIDER` writes; `server.ts` route registration; `views/layout.tsx` nav entry; `static/style.css` additions (reuse existing card/modal/masked patterns).
- **docker-compose.yml**: bind-mount `./provider-keys.json:/opt/ai-engkit/provider-keys.json:rw` into the admin service (prod). `docker-compose.dev.yml`: no host bind (matches existing `.env` behavior).
- **Apply mechanism**: docker exec into the `ai-dev` container to write `auth.json` and restart the opencode server; entrypoint scripts unchanged (they already own `opencode.json` generation).
- **Tests**: `test/test-admin-ui.sh` (API + page), plus an integration check for the key-apply path.
- **Docs**: README env var table note, `docs/knowledge/` capture after implementation.
