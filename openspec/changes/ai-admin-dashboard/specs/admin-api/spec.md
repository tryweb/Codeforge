## ADDED Requirements

### Layer 1: Local REST API (Phase 1)

### Requirement: GET /api/status returns local system state

The ai-admin dashboard SHALL expose a local REST endpoint returning the current system state for the browser dashboard to consume.

#### Scenario: Status query from browser
- **WHEN** a GET request is sent to `/api/status` with a valid session cookie
- **THEN** a JSON response is returned containing:
  - Container status (running, restart count, uptime)
  - Component versions (OpenCode, OpenChamber, Docker, gh, glab, etc.)
  - Auth status (gh, glab, git configured, last upgrade timestamp)
  - Image digest and creation date

#### Scenario: Missing cookie returns 401
- **WHEN** a GET request to `/api/status` has no valid session cookie
- **THEN** a `401 Unauthorized` response is returned
- **AND** if the request `Accept` header includes `text/html`, a redirect to `/login` is returned instead

### Requirement: POST /api/upgrade triggers Docker API upgrade pipeline

The dashboard SHALL provide a local endpoint to trigger the 6-step Docker API upgrade pipeline. This replaces the legacy `upgrade.sh` approach.

#### Scenario: Upgrade from browser
- **WHEN** a POST request is sent to `/api/upgrade` with a valid session cookie
- **THEN** the 6-step upgrade pipeline starts: digest compare → backup → merge .env → recreate ai-dev → poll health → cleanup
- **AND** a JSON response is returned: `{"status": "started", "log_url": "/api/upgrade/log"}`
- **AND** while an upgrade is in progress, subsequent requests return HTTP 409 Conflict

#### Scenario: Upgrade log via SSE
- **WHEN** a GET request is sent to `/api/upgrade/log`
- **THEN** a Server-Sent Events stream delivers structured JSON progress events for each pipeline step in real time

#### Scenario: Upgrade targets only ai-dev
- **WHEN** the recreate step runs
- **THEN** the command is `docker compose -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-dev`
- **AND** the admin container is never targeted or recreated during upgrade

### Requirement: POST /api/login authenticates session

The dashboard SHALL provide a login endpoint that validates the admin password and sets a session cookie.

#### Scenario: Successful login
- **WHEN** a POST request is sent to `/api/login` with `{"password": "<correct_password>"}`
- **THEN** a `Set-Cookie` header is returned with an HMAC-SHA256 signed session token
- **AND** the cookie has `HttpOnly`, `SameSite=Lax`, no `Max-Age` (session cookie — expires on browser close)
- **AND** a JSON response `{"ok": true}` is returned

#### Scenario: Failed login
- **WHEN** the password is incorrect
- **THEN** a `401 Unauthorized` response is returned
- **AND** the error message does not distinguish between "wrong password" and "user doesn't exist" (only one admin)

#### Scenario: Brute-force protection
- **WHEN** 5 consecutive failed login attempts occur
- **THEN** the server delays subsequent attempts by 3 seconds before responding

### Requirement: POST /api/logout clears session

The dashboard SHALL allow the user to sign out without closing the browser.

#### Scenario: Logout
- **WHEN** a POST request is sent to `/api/logout` with a valid session cookie
- **THEN** the session cookie is cleared (`Set-Cookie: session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
- **AND** a JSON response `{"ok": true}` is returned

### Requirement: GET /login renders the login page

The dashboard SHALL serve a server-rendered login page for browser access.

#### Scenario: Open login page
- **WHEN** a GET request is sent to `/login`
- **THEN** a minimal HTML page is returned with a password form
- **AND** the form posts to `/api/login`
- **AND** the page includes a hidden `redirect` field for post-login navigation

### Requirement: GET /healthz provides liveness probe

The dashboard SHALL expose an unauthenticated endpoint for Docker healthcheck.

#### Scenario: Health check
- **WHEN** a GET request is sent to `/healthz`
- **THEN** a `200 OK` response is returned with `{"status":"ok"}`
- **AND** no authentication is required
- **AND** the endpoint returns 200 even if ai-dev is down (admin itself is healthy)

### Requirement: GET /setup and POST /api/setup for first-run configuration

The dashboard SHALL detect when `ADMIN_PASSWORD` is not set in `.env` and redirect to a setup page.

#### Scenario: First-run redirect
- **WHEN** `ADMIN_PASSWORD` is empty or missing from `/opt/ai-engkit/.env`
- **THEN** all authenticated routes (`/`, `/api/*`) redirect to `/setup`
- **AND** `/login` also redirects to `/setup` (no password to log in with yet)

#### Scenario: Setup page renders
- **WHEN** a GET request is sent to `/setup`
- **THEN** an HTML page is returned with: "Configure Admin Password"
- **AND** a password form with confirmation field
- **AND** a note: "This password will be written to .env and used to secure the dashboard"

#### Scenario: Set initial password
- **WHEN** a POST request is sent to `/api/setup` with `{"password": "...", "confirm": "..."}`
- **THEN** the server validates that password matches confirmation (min 8 chars)
- **AND** writes `ADMIN_PASSWORD=<password>` to `/opt/ai-engkit/.env`
- **AND** creates a session cookie (same as POST /api/login)
- **AND** redirects to `/`
- **AND** subsequent requests no longer show the setup page

#### Scenario: Password already set redirects
- **WHEN** `ADMIN_PASSWORD` is already configured and a GET request is sent to `/setup`
- **THEN** the server redirects to `/login` (or `/` if already authenticated)

### Requirement: GET /api/status includes ai-dev container state

The dashboard SHALL report whether the ai-dev container is reachable, so the frontend can disable exec-dependent sections.

#### Scenario: ai-dev running
- **WHEN** `docker compose ps` shows ai-dev as "Up"
- **THEN** `/api/status` includes `"container_status": "running"` and `"uptime_seconds": <N>`

#### Scenario: ai-dev stopped
- **WHEN** `docker compose ps` shows ai-dev as "Exited" or not found
- **THEN** `/api/status` includes `"container_status": "stopped"`
- **AND** the frontend shows a global banner: "ai-dev container is not running"
- **AND** all exec-dependent UI sections (auth, SSH, git, projects, upgrade) are disabled

### Layer 2: Agent Connection Module (Future Phase — Architecture Reference)

*The following requirements are architecture reference for future implementation. They are NOT in Phase 1 scope.*

### Requirement: Agent establishes outbound WebSocket connection to Center

The ai-admin agent SHALL initiate an outbound WebSocket connection to a configurable Center Server URL at startup.

#### Scenario: Connect to Center
- **WHEN** ai-admin starts and `CENTER_URL` is configured
- **THEN** the agent establishes a WebSocket (wss://) connection to the Center Server
- **AND** a TLS handshake is performed with client certificate validation

#### Scenario: Connection failure with retry
- **WHEN** the Center Server is unreachable
- **THEN** the agent retries with exponential backoff (1s, 2s, 4s, 8s, max 60s)
- **AND** local dashboard operation continues unaffected during disconnection

#### Scenario: No Center configured
- **WHEN** `CENTER_URL` is not set
- **THEN** the agent connection module does not start
- **AND** only local dashboard mode is available

### Requirement: Heartbeat and status reporting

The agent SHALL periodically report its status to the Center Server over the WebSocket connection.

#### Scenario: Regular heartbeat
- **WHEN** the agent is connected to Center
- **THEN** it sends a JSON heartbeat message every 60 seconds
- **AND** the heartbeat payload matches the `/api/status` response format
- **AND** the Center can use this data for monitoring dashboards

#### Scenario: Command reception
- **WHEN** the Center sends a command message
- **THEN** the agent parses the command and executes it
- **AND** the agent reports execution progress back over the same WebSocket
- **AND** supported commands include: `upgrade`, `reconfigure`, `restart`, `exec`
