# Admin Secrets Management — Separating Credentials from Env Editor

## Context

ai-admin's original Env Editor (`/env`) provides a single interface for editing all `.env` variables — both configuration values (ports, paths, feature flags) and credentials (passwords, API keys). The editor uses a table layout and requires a container restart ("Restart ai-dev" button) to apply changes.

Three credentials are managed:
- `ADMIN_PASSWORD` — Admin dashboard login; read by `auth.ts` via `readEnvFile()` on every request
- `OPENCHAMBER_UI_PASSWORD` — OpenChamber Web UI login; consumed by OpenChamber process at startup via `process.env`
- `OPENCODE_SERVER_PASSWORD` — OpenCode API Basic Auth; consumed by OpenCode server at startup via `process.env`; port 4095 not exposed externally in standard ai-engkit deployment

## Problem

1. **Mixed concerns**: Passwords and config settings are in the same table, same edit flow
2. **Incorrect UX cues**: The editor always shows "Restart ai-dev" after edits, but `ADMIN_PASSWORD` actually takes effect immediately (auth.ts re-reads `.env` on every request)
3. **Missing context**: `OPENCODE_SERVER_PASSWORD` is listed without explaining that OpenCode's port isn't exposed externally, making its modification low-value in standard deployments
4. **No differentiation**: Users can't tell which changes need a restart and which don't

## Solution

Extract the three secrets into a dedicated **Secrets** page (`/secrets`) with an independent API (`/api/secrets`), while leaving the Env Editor intact.

### API Design

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/secrets` | Returns metadata array (key, description, hasValue, activationStatus, note). **Never returns values.** |
| `GET` | `/api/secrets/:key/value` | Returns plaintext for a single secret (called on-demand for Show toggle) |
| `PUT` | `/api/secrets/:key` | Updates a single secret; validates key exists in schema |

`activationStatus` enum:
- `"immediate"` — `ADMIN_PASSWORD` only; change takes effect without restart
- `"restart_required"` — all other secrets; container restart needed

### UI Design

Card-based layout (not table), one card per secret:

```
┌──────────────────────────────────────┐
│  🔐 Admin Password                   │
│  Admin dashboard login password      │
│  ●●●●●●●●               [Show][Edit] │
│  ✅ Takes effect immediately         │
└──────────────────────────────────────┘
```

Each card shows: icon + name, description, masked value (click Show to reveal via API), activation status badge, and Edit button. `OPENCODE_SERVER_PASSWORD` has a collapsible info note explaining the defense-in-depth rationale.

### Data Flow

- Secrets API shares the same `.env` file (`/opt/ai-engkit/.env`) via existing `readEnvFile()` / `upsertEnvVar()` helpers
- No caching — `readEnvFile()` reads from disk on every call, so `ADMIN_PASSWORD` changes are immediately reflected in auth checks
- No session invalidation on password change — session is HMAC-signed; changing `ADMIN_PASSWORD` invalidates existing sessions (user must re-login), which is expected behavior

## Why It Works

- **Separation of concerns**: Secrets page handles credentials, Env Editor handles config — each has appropriate UX for its domain
- **Correct feedback**: Each secret shows its actual activation requirement (immediate vs restart)
- **Minimal code change**: Reuses existing `.env` read/write functions; no changes to auth, docker, or compose logic
- **No data inconsistency**: Both pages read/write the same `.env` file, so edits from either side are visible to both

## Side Effects / Tradeoffs

- `ADMIN_PASSWORD` change invalidates the current session — user is redirected to login. This is consistent with standard password-change behavior.
- Env Editor still shows all variables including passwords — user can edit the same secret from two places. No inconsistency risk (same file), but slightly redundant.
- `OPENCODE_SERVER_PASSWORD` is retained in the UI with a note rather than removed entirely, to avoid confusing users who set it during installation.
- Mobile support inherits existing admin responsive CSS (hamburger nav, 44px touch targets, modal max-width). Secrets-specific additions: `flex-wrap` on card action buttons and `flex-direction: column` at ≤768px.

## Evidence

Verified via curl API tests and Playwright E2E:

```
GET  /api/secrets          → 200, 3 secrets, no values exposed
GET  /api/secrets/ADMIN_PASSWORD/value → 200, returns plaintext
PUT  /api/secrets/:key     → 200, updates .env, returns activationStatus
PUT  /api/secrets/NONEXISTENT → 404
PUT  /api/secrets/:key (empty value) → 400
GET  /secrets              → HTML with 3 cards, correct badges
```

## Related Files

- `src/admin/routes/secrets.ts` — secrets API routes
- `src/admin/views/secrets.tsx` — secrets page UI
- `src/admin/views/layout.tsx` — nav link
- `src/admin/server.ts` — route registration
- `src/admin/lib/env.ts` — shared `.env` read/write
- `src/admin/lib/auth.ts` — ADMIN_PASSWORD consumption (runtime read, not cached)
- `docs/knowledge/architecture/admin-env-editor-dataflow.md` — original env editor architecture
- `openspec/changes/admin-secrets-page/` — full change artifacts (proposal, design, specs, tasks)
- `test/test-admin-ui.sh` — curl-based API tests

## Tags

`secrets-management` `env-editor` `admin-dashboard` `api-design` `ux` `password`
