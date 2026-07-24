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
