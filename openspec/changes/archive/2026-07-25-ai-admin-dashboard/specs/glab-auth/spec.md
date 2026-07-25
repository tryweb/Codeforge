## ADDED Requirements

### Requirement: Dashboard shows current GitLab auth status

The ai-admin dashboard SHALL display whether the ai-dev container is authenticated with GitLab CLI, by running the check inside ai-dev via exec.

#### Scenario: Authenticated status
- **WHEN** the dashboard calls `docker compose exec -T ai-dev glab auth status`
- **AND** it returns exit code 0
- **THEN** the dashboard shows "✅ Connected to <gitlab-instance>" with a "Disconnect" button

#### Scenario: Not authenticated
- **WHEN** `docker compose exec -T ai-dev glab auth status` fails
- **THEN** the dashboard shows "❌ Not connected to GitLab" with a "Connect GitLab" button

### Requirement: User can initiate GitLab auth via device code flow

The dashboard SHALL guide the user through `glab auth login` device-code authentication, running inside ai-dev via exec.

#### Scenario: Start device code flow
- **WHEN** the user clicks "Connect GitLab"
- **THEN** the dashboard prompts for the GitLab instance hostname (default: `gitlab.com`)
- **AND** upon confirmation, the backend runs `docker compose exec -T ai-dev glab auth login --hostname <instance>`
- **AND** the `-T` flag ensures stdout is plain text
- **AND** the device code is captured and displayed
- **AND** the dashboard shows countdown and instructions matching the gh-auth flow

#### Scenario: Self-hosted GitLab instance
- **WHEN** the user enters a custom hostname (e.g., `gitlab.example.com`)
- **THEN** `docker compose exec -T ai-dev glab auth login --hostname <custom>` is used instead of the default
- **AND** the instance URL is stored for subsequent status checks

### Requirement: User can disconnect GitLab

The dashboard SHALL allow the user to log out of GitLab CLI inside ai-dev.

#### Scenario: Disconnect
- **WHEN** the user clicks "Disconnect" in the GitLab section
- **THEN** the backend runs `docker compose exec -T ai-dev glab auth logout`
- **AND** the dashboard returns to "❌ Not connected" state

#### Cross-cutting: ai-dev unavailable
- **WHEN** ai-dev container is not running
- **THEN** the GitLab auth section shows "ai-dev container is not running"
- **AND** the "Connect GitLab" and "Disconnect" buttons are disabled
