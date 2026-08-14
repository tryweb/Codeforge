# Admin Agent Model Config

## Why

OMO (oh-my-openagent 4.19.4) decides every agent's model via built-in `AGENT_MODEL_REQUIREMENTS` fallback chains resolved against the currently connected providers — so the model each agent (sisyphus, oracle, explore, …) actually runs is dynamic and invisible, and the admin UI has no way to pin or override it. Research confirmed the only plugin-consumed override is `agents.<name>.fallback_models` in `~/.omo/omo.jsonc`, and that the admin container can reach it only through `docker exec` into ai-dev. This change gives the Admin interface a dedicated, verified way to configure each OMO agent's default and fallback models.

## What Changes

- **New Admin page "Agent Models"** (`/agent-models`): table of all OMO agents showing the *resolved* current model (from live `/agent`), the *configured* fallback chain (from `~/.omo/omo.jsonc`), and per-agent editing of default + fallback models with optional variant.
- **New API routes** (`/api/agent-models`): `GET` returns per-agent configured `fallback_models` + resolved model; `PUT /api/agent-models/:agent` validates and writes a targeted `agents.<name>.fallback_models` update into `~/.omo/omo.jsonc` via `execInAiDev` (jq, touching only the target key), then restarts ai-dev.
- **Apply confirmation on save**: after restart the API confirms the write landed and the managed opencode server came back (`/agent` re-reads config from disk on restart); the reported current model is informational (it reflects the plugin default, never `fallback_models` — verified empirically), so it is shown, not asserted. Rollback of the written config happens only when the write or the restart fails.
- **E2E regression test** (`test/test-agent-model-e2e.sh`): set → verify → restore loop proving a configured model actually takes effect, with `trap`-guaranteed restoration.
- **Safety requirement**: the feature requires `OPENCODE_SERVER_PASSWORD` in `.env` (otherwise OpenChamber rotates a per-spawn password the admin cannot know); the UI surfaces this as a prerequisite warning and the API rejects writes when it is absent.

## Capabilities

### New Capabilities
- `admin-agent-model-config`: Admin interface capability for reading and writing per-OMO-agent default/fallback model configuration, including live resolved-model verification.

### Modified Capabilities
<!-- None: existing omo-config-persistence / omo-unified-config requirements are unchanged — admin writes are user content that already persists and already wins the shallow merge. -->

## Impact

- **Code**: new `src/admin/routes/agent-models.ts`, new `src/admin/views/agent-models.tsx`, nav entry in `src/admin/views/layout.tsx`, a small `src/admin/lib/agent-models.ts` (config read/write + verification helpers), route wiring in `src/admin/server.ts`.
- **Runtime state**: writes `agents.<name>.fallback_models` into `~/.omo/omo.jsonc` (the `omo-config` volume in ai-dev); survives restarts via the existing shallow merge.
- **Behavior**: changing an agent's models requires an ai-dev restart (interrupts active sessions — the UI must confirm before applying).
- **Dependencies**: jq in ai-dev (already present); `execInAiDev` / `restartAiDev` admin helpers (already present); managed opencode server `/agent` endpoint with Basic auth.
- **Tests**: `test/test-agent-model-e2e.sh` (new), route unit tests in `src/admin/routes/agent-models.test.ts` (new), existing test suite must stay green.
