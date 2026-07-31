## Context

See proposal.md for motivation. Current state that shapes this design:

- Admin is Bun + Hono + server-rendered JSX (`src/admin/`), with established patterns: `lib/env.ts` (`readEnvFile`/`upsertEnvVar` → `/opt/ai-engkit/.env`), the Secrets page (`routes/secrets.ts` + `views/secrets.tsx` — card layout, masked values, metadata-only list API, reveal-on-demand, activation badges), and the env restart endpoint (`POST /api/env/restart` → compose recreate in prod / `docker restart` in dev).
- Provider definitions live in `OPENCODE_PROVIDER` (single-line JSON, sibling provider keys), merged into `opencode.json` by `entrypoint.d/02-init-config.sh` at every boot.
- `opencode-go` (the oh-my-openagent plugin's low-cost provider tier) is NOT defined in `OPENCODE_PROVIDER`. Its credential lives in opencode's auth store (`~/.local/share/opencode/auth.json` in the ai-dev container) and the plugin's provider probe caches results in `~/.cache/oh-my-opencode/{connected-providers,provider-models,model-capabilities}.json`.
- Dev/DooD limitation: env vars changed via admin cannot apply in dev mode (`docker restart` preserves original env); file-based writes inside the ai-dev container work in both modes.

## Goals / Non-Goals

**Goals:**
- Structured admin UI/API for provider definitions, persisting to `OPENCODE_PROVIDER` with validation and deletion.
- A generic per-provider key registry (file-backed) with manual active-key selection, applied to the opencode auth store for `opencode-go` initially.
- Work in both production and dev/DooD deployment modes.

**Non-Goals:**
- Multi-key support for providers other than `opencode-go` (registry is provider-agnostic; the apply rule is only wired for `opencode-go`).
- Key auto-rotation, load balancing, or per-session key picking.
- A structured models editor (raw JSON fallback covers it).
- Changes to the entrypoint's config-generation ownership.

## Decisions

### 1. Key registry is a dedicated JSON file, not `.env` or `auth.json`
Registry at `/opt/ai-engkit/provider-keys.json`, sibling of `.env`, with the same dual-mode file access as `env.ts` (prod: bind-mounted `rw`; dev: container-local).

```json
{
  "providers": {
    "opencode-go": {
      "keys": [
        { "id": "k-1", "value": "sk-...", "createdAt": "2026-07-31T..." },
        { "id": "k-2", "value": "sk-...", "createdAt": "2026-07-31T..." }
      ],
      "activeKeyId": "k-1"
    }
  }
}
```

- Why not `.env`: keys would be visible via `docker inspect` and, in dev mode, env edits from admin never apply — a key registry that cannot be persisted would be useless.
- Why not `auth.json` directly: `auth.json` is opencode-owned with an undocumented per-provider schema; storing N keys there means juggling N credentials in a format we don't control. The registry owns the key list; `auth.json` only ever holds the one active key.
- File permissions `0600`; auto-created by the admin lib on first write.

### 2. Apply mechanism: docker exec into ai-dev → auth.json write → cache clear → container restart
Selecting an active key for `opencode-go` performs, via existing `lib/docker.ts` exec helpers:

1. Read `~/.local/share/opencode/auth.json` from ai-dev, set `opencode-go.key` to the active key (read-modify-write preserving other providers' entries — use `jq` inside the container, never echo the key to logs).
2. Delete `~/.cache/oh-my-opencode/{connected-providers,provider-models,model-capabilities}.json` so the plugin's provider probe re-runs.
3. Restart via the existing env-restart path (`docker restart ai-dev`, compose recreate in prod) — the entrypoint regenerates `opencode.json` from unchanged env and `auth.json` persists in the `opencode-config` volume.

- Why container restart rather than targeted opencode-server process kill: we have no reliable handle on the opencode server lifecycle (OpenChamber manages a `managed-opencode` server); `docker restart` is the known-good, already-implemented path. Cost: brief downtime of running processes, identical to the env editor's restart.
- Alternatives rejected: env-var injection (cannot express multi-key selection, fails in dev mode); writing all keys into `auth.json` (unsupported format, credential juggling).

### 3. API shape mirrors the Secrets page
- `GET /api/providers` — provider metadata (from `OPENCODE_PROVIDER`): name, npm, baseURL, hasApiKey; key registry summary per provider (count, active id, masked last-4). No plaintext.
- `GET /api/providers/:name/key-value` — plaintext for a single registry key (reveal on demand).
- `PUT /api/providers/:name` — upsert provider (structured fields + optional raw JSON fallback); writes `OPENCODE_PROVIDER` via `upsertEnvVar`, returns restart-required semantics.
- `DELETE /api/providers/:name` — remove provider; remove `OPENCODE_PROVIDER` entirely when the last one is deleted.
- `POST /api/providers/:name/keys` / `DELETE /api/providers/:name/keys/:keyId` — registry mutations; deleting the active key promotes the next.
- `PUT /api/providers/:name/keys/:keyId/active` — select active key; for `opencode-go` this triggers the apply sequence, otherwise just persists the selection.
- `GET /api/providers/:name/keys/import-candidate` / `POST /api/providers/:name/keys/import` — read the existing `auth.json` key and offer/perform the first-run import (user-initiated, per spec).

### 4. Provider validation
`OPENCODE_PROVIDER` must parse as JSON and each provider entry must be an object (npm string, options object, models object — those present). Rejects with 400, `.env` untouched. The env editor's `PUT /api/env/:key` gains the same JSON validation for `OPENCODE_PROVIDER` writes.

### 5. UI reuses existing primitives
`views/providers.tsx` = Secrets-style cards (provider metadata + masked key placeholder + Show/Edit), each with an "API Keys" section (key list with masked entries, active radio, add/delete, import action) and an activation note (restart-required). Styling from existing `style.css` classes (`.card`, `.modal`, `.badge`, `.masked-value`); no new CSS framework.

## Risks / Trade-offs

- **Unknown `auth.json` schema** → Step 0 of tasks is empirical verification: read the actual `auth.json` in the dev container before implementing the apply writer; the write uses jq merge so unknown sibling fields are preserved.
- **Plugin cache staleness** → Apply explicitly deletes the three cache files; the plugin rewrites them lazily on the next probe (documented behavior in the OMO model-defaults knowledge entry).
- **`docker restart` downtime / running-session loss** → Same tradeoff as the existing env editor restart; the UI states it before applying.
- **Keys at rest in plaintext** → Same trust level as `.env` keys today; mitigated by `0600` permissions, masking in the API, and reveal-on-demand.
- **Dev mode registry file is container-local** → Consistent with existing `.env` behavior in dev; document that dev deployments should re-enter keys after a full `docker compose down && up` from the host.

## Migration Plan

1. Deploy: add `./provider-keys.json:/opt/ai-engkit/provider-keys.json:rw` to the admin service in `docker-compose.yml` (prod). No compose change needed in dev.
2. Existing deployments: the import action migrates the current `auth.json` `opencode-go` key into the registry on first use; nothing else changes until then.
3. Rollback: remove the admin page/API and the compose mount; `OPENCODE_PROVIDER` and `auth.json` are untouched by rollback (the apply sequence only runs on explicit user action).
