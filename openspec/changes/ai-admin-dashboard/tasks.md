## 1. Project Scaffolding & Server Skeleton

- [x] 1.1 Create `src/admin/` directory structure with `server.ts`, `routes/`, `views/`, `static/`
- [x] 1.2 Implement `docker compose exec` orchestration helper (shared utility for running commands inside ai-dev, capturing stdout/stderr, timeout enforcement)
- [x] 1.3 Scaffold Hono server with basic middleware (CORS, auth, logging, error handling)
- [x] 1.4 Implement dashboard auth middleware (HMAC-signed session cookie check against `ADMIN_PASSWORD`, no Max-Age)
- [x] 1.5 Add static file serving and a basic HTML layout shell
- [x] 1.6 Create login page (server-rendered HTML form, POST to /api/login, sets session cookie on success)
- [x] 1.7 Create main dashboard layout with navigation sidebar

## 2. Version Dashboard (Capability: version-dashboard)

- [x] 2.1 Implement `GET /api/versions` endpoint that runs CLI version commands
- [x] 2.2 Add image metadata endpoint (`GET /api/versions/image`) reading from `/proc/self/cgroup` and env
- [x] 2.3 Build version dashboard HTML view with component table
- [x] 2.4 Add error handling for unavailable components (timeout, missing CLI)

## 3. .env Configuration Editor (Capability: env-config)

- [x] 3.1 Implement `GET /api/env` endpoint that reads and parses `.env` file
- [x] 3.2 Implement `PUT /api/env/:key` endpoint for single-variable updates (atomic write)
- [x] 3.3 Build env variable schema definition (type, validation rules per known key)
- [x] 3.4 Build env editor HTML view with inline editing, validation, masked secrets
- [x] 3.5 Add "Create from default template" flow for missing `.env` files

## 4. Upgrade Engine (Capability: upgrade-engine)

- [x] 4.1 Implement 6-step upgrade pipeline (digest compare → backup → merge .env → recreate ai-dev → poll health → cleanup) via Docker API
- [x] 4.2 Implement `POST /api/upgrade` endpoint that triggers the pipeline as a background process (returns `{"status":"started","log_url":"/api/upgrade/log"}`)
- [x] 4.3 Implement SSE endpoint `GET /api/upgrade/log` for structured JSON event streaming (step name, status, message per event)
- [x] 4.4 Add upgrade state tracking (idle/running/completed/failed) with HTTP 409 concurrency guard
- [x] 4.5 Implement backup/restore to/from `/opt/ai-engkit/backups/pre-<timestamp>/`
- [x] 4.6 Implement automatic rollback (restore .env + compose.yml on failure)
- [x] 4.7 Build upgrade HTML view with step-by-step progress indicator, log viewer, and status banner
- [x] 4.8 Add "last upgrade log" persistence and review
- [x] 4.9 Ensure all `docker compose` commands target only `ai-dev` service (never recreate admin)

## 5. OpenCode Project Init (Capability: project-init)

- [x] 5.1 Implement `GET /api/projects` endpoint that lists workspace directories (via `docker compose exec -T ai-dev ls ~/workspace/`)
- [x] 5.2 Implement `POST /api/projects` endpoint for creating new project directories (via `docker compose exec -T ai-dev mkdir -p ~/workspace/<name>`)
- [x] 5.3 Add `.opencode.json` initialization for new projects (via `docker compose exec -T ai-dev opencode --new ...`)
- [x] 5.4 Build project init HTML view with form, validation, and project list

## 6. GitHub CLI Auth (Capability: gh-auth)

- [x] 6.1 Implement `POST /api/auth/gh/start` endpoint that runs `docker compose exec -T ai-dev gh auth login --web --hostname github.com`
- [x] 6.2 Implement device code capture from exec'd `gh auth login` stdout (parsing plain text output, no TTY)
- [x] 6.3 Implement `GET /api/auth/gh/status` endpoint (polls `docker compose exec -T ai-dev gh auth status`)
- [x] 6.4 Implement `POST /api/auth/gh/logout` endpoint (runs `docker compose exec -T ai-dev gh auth logout`)
- [x] 6.5 Build GitHub auth HTML view with device code display, countdown, status polling

## 7. GitLab CLI Auth (Capability: glab-auth)

- [x] 7.1 Implement `POST /api/auth/glab/start` endpoint (accepts hostname, runs `docker compose exec -T ai-dev glab auth login --hostname <instance>`)
- [x] 7.2 Implement device code capture from exec'd `glab auth login` stdout
- [x] 7.3 Implement `GET /api/auth/glab/status` endpoint (polls `docker compose exec -T ai-dev glab auth status`)
- [x] 7.4 Implement `POST /api/auth/glab/logout` endpoint (runs `docker compose exec -T ai-dev glab auth logout`)
- [x] 7.5 Build GitLab auth HTML view with hostname input, device code display, status polling

## 8. Git Configuration (Capability: git-config)

- [x] 8.1 Implement `GET /api/git/config` endpoint that runs `docker compose exec -T ai-dev git config --global --list`
- [x] 8.2 Implement `PUT /api/git/config` endpoint for setting `user.name` / `user.email` (via `docker compose exec -T ai-dev git config --global ...`)
- [x] 8.3 Implement `GET /api/git/credentials` endpoint reading `~/.git-credentials` via exec
- [x] 8.4 Build Git config HTML view with identity form and credentials display

## 9. SSH Key Management (Capability: ssh-keys)

- [x] 9.1 Implement `GET /api/ssh/keys` endpoint listing `~/.ssh/` contents via exec, with `ssh-keygen -lf` for fingerprints
- [x] 9.2 Implement `POST /api/ssh/keys` endpoint for generating new key pairs (via `docker compose exec -T ai-dev ssh-keygen ...`)
- [x] 9.3 Implement `GET /api/ssh/keys/:name/pub` endpoint returning the public key content (via `docker compose exec -T ai-dev cat ~/.ssh/<name>.pub`)
- [x] 9.4 Build SSH keys HTML view with key list, generation form, and public key display

## 10. Docker Compose Integration

- [x] 10.1 Add `ai-admin` service block to `docker-compose.yml` (override entrypoint, ADMIN_PORT 8080, volumes: .env + compose.yml + backups + docker socket at `/opt/ai-engkit/` paths)
- [x] 10.2 Add `ai-admin` service block to `docker-compose.dev.yml` (override entrypoint, ADMIN_DEV_PORT 8081, bind mount src/admin for hot reload, --watch flag)
- [x] 10.3 Add healthcheck stanza to ai-admin service (curl /healthz, interval 30s, start_period 10s)
- [x] 10.4 Add new `.env` variables: `ADMIN_PORT`, `ADMIN_DEV_PORT`, `ADMIN_PASSWORD`
- [x] 10.5 Add `ADMIN_PASSWORD` prompt to `install.sh` (required, no default — same flow as `OPENCHAMBER_UI_PASSWORD`)
- [x] 10.6 Update `install.sh` to handle new `ai-admin` service startup
- [x] 10.7 Update `.env.example` with admin service defaults (`ADMIN_PORT=8080`, `ADMIN_DEV_PORT=8081`, `ADMIN_PASSWORD=`, `BACKUP_RETENTION=5`)

## 11. Admin API & Agent Connection (Capability: admin-api)

### Phase 1 — Local REST API

- [x] 11.1 Implement `POST /api/login` endpoint (validate password → set HMAC-signed session cookie, no Max-Age)
- [x] 11.2 Implement `POST /api/logout` endpoint (clear session cookie)
- [x] 11.3 Implement `GET /api/status` aggregate endpoint (container state + versions + auth status + ai-dev container_status)
- [x] 11.4 Implement `GET /healthz` unauthenticated liveness probe (return 200, no auth required)
- [x] 11.5 Implement first-run detection + redirect to `/setup` when `ADMIN_PASSWORD` not set
- [x] 11.6 Implement `GET /setup` and `POST /api/setup` endpoints (set initial ADMIN_PASSWORD, create session)
- [x] 11.7 Implement brute-force protection on login (5 failures → 3s delay)
- [x] 11.8 Add rate limiting middleware (30 req/min for API routes)
- [x] 11.9 Add OpenAPI spec for the admin API at `GET /api/openapi.json`

### Phase 2+ — Agent Connection Module (Not in Phase 1 scope)

- [ ] *(Future)* Implement outbound WebSocket client with exponential backoff reconnect
- [ ] *(Future)* Implement heartbeat protocol (status report every 60s)
- [ ] *(Future)* Implement command dispatch (upgrade, reconfigure, restart)
- [ ] *(Future)* Implement TLS mutual authentication for Center connection

## 12. Testing & Documentation

- [x] 12.1 Add integration tests for all API endpoints
- [x] 12.2 Add UI smoke test using Playwright (login → view dashboard)
- [x] 12.3 Update `docs/ARCHITECTURE.md` with ai-admin service and architecture decisions
- [x] 12.4 Update `README.md` with admin dashboard section (URL, default credentials, features)

## 13. Update Check Engine (Capability: upgrade-engine)

- [x] 13.1 Implement semver comparison utility (parse, strip leading v, ignore pre-release, pad segments)
- [x] 13.2 Implement `GET /api/versions/check-update` endpoint (fetch GHCR tags, find highest semver, compare with local)
- [x] 13.3 Implement in-memory cache with 5-minute TTL, in-flight promise collapsing, and failure isolation
- [x] 13.4 Integrate update check into Dashboard's `GET /` handler (server-side resolution with cache)
- [x] 13.5 Add GHCR registry tag parsing (filter valid semver from `tags/list` response, handle empty/error)

## 14. Dashboard Inline Upgrade (Capability: upgrade-engine)

- [x] 14.1 Implement `GET /api/upgrade/status` unified endpoint (returns `{ state, events, current_step, progress_pct }`)
- [x] 14.2 Add monotonic `id` field to `UpgradeEvent` type and emit logic
- [x] 14.3 Fix SSE subscriber leak (replace `return () => unsub()` with proper abort handling)
- [x] 14.4 Add event deduplication to SSE client (track last received ID, skip duplicates)
- [x] 14.5 Handle `409` on POST `/api/upgrade` as "attach to existing run" instead of error
- [x] 14.6 Modify Dashboard's Component Versions card to show tri-state update badge (checking/current/update-available/check-failed)
- [x] 14.7 Implement inline upgrade progress UI in Dashboard (expandable step-by-step progress below version row)
- [x] 14.8 Add confirmation dialog before upgrade trigger
- [x] 14.9 Re-run version check after upgrade completes and update badge
