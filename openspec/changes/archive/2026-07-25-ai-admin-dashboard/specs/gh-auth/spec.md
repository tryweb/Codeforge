## ADDED Requirements

### Requirement: Dashboard shows current GitHub auth status

The ai-admin dashboard SHALL display whether the ai-dev container is authenticated with GitHub CLI, by running the status check inside ai-dev via exec.

#### Scenario: Authenticated status
- **WHEN** the dashboard calls `docker compose exec -T ai-dev gh auth status`
- **AND** it returns exit code 0
- **THEN** the dashboard shows "✅ Connected as <username>" with a "Disconnect" button

#### Scenario: Not authenticated
- **WHEN** `docker compose exec -T ai-dev gh auth status` fails
- **THEN** the dashboard shows "❌ Not connected to GitHub" with a "Connect GitHub" button

### Requirement: User can initiate GitHub auth via device code flow

The dashboard SHALL guide the user through `gh auth login --web` device-code authentication, running the command inside ai-dev via exec.

#### Scenario: Start device code flow
- **WHEN** the user clicks "Connect GitHub"
- **THEN** the backend runs `docker compose exec -T ai-dev gh auth login --web --hostname github.com`
- **AND** the `-T` flag ensures stdout is plain text (no TTY interference)
- **AND** the backend captures the device code from stdout
- **AND** the dashboard displays:
  - The one-time code prominently (e.g., `ABCD-1234`)
  - The verification URL (`https://github.com/login/device`)
  - Instructions: "Open this URL in any browser and enter the code"
  - A countdown timer showing remaining time (15 minutes)

#### Scenario: Device code flow succeeds
- **WHEN** the user completes the device code flow in their browser
- **THEN** the backend runs `docker compose exec -T ai-dev gh auth status` repeatedly until it succeeds
- **AND** the dashboard transitions to "✅ Connected as <username>"
- **AND** the device code UI is replaced with the authenticated state

#### Scenario: Device code expires
- **WHEN** the 15-minute window expires without completion
- **THEN** the dashboard shows "Code expired. Click to retry."
- **AND** a new code can be generated with a single click

### Requirement: User can disconnect GitHub

The dashboard SHALL allow the user to log out of GitHub CLI inside ai-dev.

#### Scenario: Disconnect
- **WHEN** the user clicks "Disconnect"
- **THEN** the backend runs `docker compose exec -T ai-dev gh auth logout`
- **AND** the dashboard returns to "❌ Not connected" state

#### Cross-cutting: ai-dev unavailable
- **WHEN** ai-dev container is not running
- **THEN** the GitHub auth section shows "ai-dev container is not running"
- **AND** the "Connect GitHub" and "Disconnect" buttons are disabled
