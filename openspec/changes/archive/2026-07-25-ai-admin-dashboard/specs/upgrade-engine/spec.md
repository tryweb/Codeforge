## ADDED Requirements

### Requirement: User can trigger upgrade from dashboard

The ai-admin dashboard SHALL provide a button to execute the Docker API upgrade pipeline with real-time feedback. This replaces the existing `upgrade.sh` script.

#### Scenario: Pre-flight — digest comparison
- **WHEN** the user views the upgrade section
- **THEN** the current image digest is retrieved via `docker images ghcr.io/tryweb/ai-engkit:latest --no-trunc`
- **AND** the available digest is fetched by running `docker pull ghcr.io/tryweb/ai-engkit:latest` and comparing digests
- **AND** the dashboard displays: "Current: <digest>" and "Available: <digest>" side by side
- **AND** if digests match: an "Up to date" badge is shown, upgrade button is disabled
- **AND** if digests differ: an "Upgrade Available" badge is shown, upgrade button is enabled

#### Scenario: Execute upgrade pipeline
- **WHEN** the user clicks "Upgrade Now"
- **THEN** a confirmation dialog warns: "ai-dev will restart during this upgrade (2-3s downtime)"
- **AND** upon confirmation, the 6-step pipeline begins:
  1. **Digest compare** — `docker pull` to get latest digest, compare with current
  2. **Backup** — copy `/opt/ai-engkit/.env` and `/opt/ai-engkit/compose.yml` to `/opt/ai-engkit/backups/pre-<timestamp>/`
  3. **Merge .env** — curl `.env.example` from upstream repo, append any new keys to `.env`
  4. **Recreate** — `docker compose -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-dev`
  5. **Poll health** — poll `docker compose ps` until ai-dev shows "Up" or 60s timeout
  6. **Cleanup** — `docker image prune -f` to remove dangling images
- **AND** each step emits a progress event with step name + status (running/success/fail)
- **AND** the dashboard shows a step-by-step progress indicator

#### Scenario: Upgrade already in progress
- **WHEN** the user clicks "Upgrade Now" while an upgrade is already running
- **THEN** HTTP 409 Conflict is returned
- **AND** the dashboard shows: "Upgrade already in progress"
- **AND** the upgrade button is disabled

### Requirement: Real-time log streaming during upgrade

The dashboard SHALL stream each step's stdout/stderr to the browser via SSE.

#### Scenario: Log lines appear incrementally
- **WHEN** upgrade is running
- **THEN** a structured JSON event stream is sent:
  ```json
  {"step": 1, "name": "Digest compare", "status": "running", "message": "Pulling...", "ts": "..."}
  {"step": 1, "name": "Digest compare", "status": "success", "message": "Digest changed: abc123 → def456", "ts": "..."}
  {"step": 2, "name": "Backup", "status": "running", "message": "Copying .env...", "ts": "..."}
  ```
- **AND** the terminal-styled log viewer displays each message
- **AND** auto-scrolls to the bottom

#### Scenario: Upgrade completes
- **WHEN** all 6 steps succeed
- **THEN** a green "Upgrade Complete" banner is shown
- **AND** the final version table (before → after digests) is displayed

#### Scenario: Upgrade fails at any step
- **WHEN** any step exits with a non-zero status or timeout
- **THEN** a red "Upgrade Failed" banner is shown at the failed step
- **AND** rollback is automatically initiated:
  1. Restore `.env` from `/opt/ai-engkit/backups/pre-<timestamp>/.env`
  2. Restore `compose.yml` from `/opt/ai-engkit/backups/pre-<timestamp>/compose.yml`
  3. `docker compose -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-dev`
- **AND** the dashboard shows: "Rollback complete — config restored to pre-upgrade state"

### Requirement: Upgrade log persistence

The dashboard SHALL retain the last upgrade result for review.

#### Scenario: View last upgrade log
- **WHEN** the user opens the upgrade section after a completed/failed upgrade
- **THEN** the last upgrade log (step results + messages) is available for review
- **AND** a "Clear" button dismisses the log

### Requirement: No dependency on upgrade.sh

The dashboard SHALL perform all upgrade operations via the Docker socket without invoking `upgrade.sh` as an external script.

#### Scenario: upgrade.sh is absent
- **WHEN** the host filesystem has no `upgrade.sh` (or it was deleted)
- **THEN** the upgrade pipeline continues to function normally
- **AND** the dashboard never references `upgrade.sh` in UI or documentation

## ADDED (Version 2) — Update Check Engine

### Requirement: Automatic version check against GitHub Container Registry

The dashboard SHALL check whether a newer version of the ai-engkit image is available
from GHCR (`ghcr.io/tryweb/ai-engkit`).

#### Scenario: Version comparison on dashboard load
- **WHEN** the dashboard page loads
- **THEN** the system fetches `https://ghcr.io/v2/tryweb/ai-engkit/tags/list` (anonymous, public registry)
- **AND** parses all tags to find the highest valid semver (strip leading `v`, reject non-semver, ignore `latest`)
- **AND** compares it against the local version from `/opt/ai-engkit/VERSION`
- **AND** determines one of three states: `up-to-date`, `update-available`, `check-failed`

#### Scenario: Semver comparison rules
- **WHEN** comparing versions
- **THEN** leading `v` prefix SHALL be stripped before comparison (`v1.2.3` → `1.2.3`)
- **AND** pre-release tags (containing `-rc`, `-beta`, `-alpha`, `-pre`) SHALL be excluded from upgrade candidates
- **AND** non-semver tags (`latest`, date strings, random strings) SHALL be ignored
- **AND** missing minor/patch segments SHALL be padded with zero (`1.0` → `1.0.0`)
- **AND** if local version is `dev`, the check SHALL report `check-failed` with message "development build"
- **AND** the comparison SHALL use proper semver precedence (major > minor > patch)

#### Scenario: GHCR response caching
- **WHEN** the version check succeeds
- **THEN** the result SHALL be cached in-memory for 5 minutes
- **AND** subsequent requests within the cache window SHALL return the cached result without calling GHCR
- **AND** cache failures (network error, GHCR down) SHALL NOT overwrite a previous valid cached result
- **AND** concurrent cache misses SHALL be collapsed into a single in-flight request (no duplicate fetches)

### Requirement: Inline upgrade trigger from Dashboard

The Dashboard's Component Versions card SHALL show upgrade status next to the
"AI-EngKit" version row and allow triggering the upgrade inline.

#### Scenario: Version status display in Component Versions table
- **WHEN** the Dashboard renders the Component Versions card
- **THEN** the "AI-EngKit" row SHALL show a status indicator with tri-state semantics:
  - `checking` — grey badge while check is in progress (shown for < 500ms if cached)
  - `up-to-date` — green "✓ Latest" badge, no upgrade button shown
  - `update-available` — orange "⚡ X.Y.Z Available" badge + "▲ Upgrade" button
  - `check-failed` — grey "? Unavailable" badge, no action shown
- **AND** the upgrade status SHALL be resolved server-side during dashboard render (not client-side fetch) using the 5-minute cache
- **AND** if the cache is cold, the Dashboard handler SHALL initiate the check in the background and render `checking` for the first load

#### Scenario: Inline upgrade progress
- **WHEN** the user clicks "▲ Upgrade" on the Dashboard
- **THEN** a confirmation dialog SHALL appear: "ai-dev will restart during this upgrade (2-3s downtime). Proceed?"
- **AND** upon confirmation, `POST /api/upgrade` SHALL be called
- **AND** the Component Versions card SHALL expand to show inline step-by-step progress
- **AND** the progress display SHALL consume the same SSE stream as `/api/upgrade/log`
- **AND** after upgrade completes, the version check SHALL be re-evaluated and the badge updated
- **AND** the existing `/upgrade` page SHALL remain available for detailed log review

### Requirement: Unified upgrade status endpoint

The dashboard SHALL expose a GET endpoint that returns the current upgrade state
and event history, used by both Dashboard and /upgrade page for bootstrapping.

#### Scenario: GET /api/upgrade/status
- **WHEN** a GET request is sent to `/api/upgrade/status`
- **THEN** the response SHALL be:
  ```json
  {
    "state": "idle" | "running" | "completed" | "failed",
    "events": [ ... ],
    "current_step": "digest_compare" | "backup" | ... | "",
    "progress_pct": 0-100
  }
  ```
- **AND** this endpoint SHALL be used by both Dashboard and /upgrade page on load to rehydrate state after navigation

### Requirement: SSE lifecycle reliability

The SSE stream SHALL handle reconnection and cleanup correctly.

#### Scenario: SSE disconnect cleanup
- **WHEN** a client disconnects from the SSE stream
- **THEN** the subscriber SHALL be removed from the event bus (no subscriber leak)
- **AND** the stream SHALL be properly terminated

#### Scenario: SSE reconnect and deduplication
- **WHEN** a client reconnects to the SSE stream while an upgrade is in progress
- **THEN** the initial event log SHALL be sent via `?history=1` replay
- **AND** each event SHALL carry a monotonic `id` field for deduplication
- **AND** the client SHALL skip rendering events it has already processed
