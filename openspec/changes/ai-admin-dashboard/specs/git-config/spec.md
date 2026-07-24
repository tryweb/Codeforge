## ADDED Requirements

### Requirement: Dashboard displays current Git configuration

The ai-admin dashboard SHALL display the current global Git configuration from inside ai-dev via exec.

#### Scenario: View gitconfig
- **WHEN** the user opens the Git configuration section
- **THEN** the backend runs `docker compose exec -T ai-dev git config --global --list`
- **AND** the following settings are parsed and displayed:
  - `user.name`
  - `user.email`
  - `credential.helper`
  - Any other configured keys from ai-dev's `~/.gitconfig`

#### Scenario: Empty gitconfig
- **WHEN** `user.name` or `user.email` are not set
- **THEN** the dashboard shows "(not set)" with an alert: "Git identity not configured"

### Requirement: User can set Git identity

The dashboard SHALL provide a form to set `user.name` and `user.email` inside ai-dev.

#### Scenario: Set user.name and user.email
- **WHEN** the user enters name and email and clicks "Save"
- **THEN** the backend runs `docker compose exec -T ai-dev git config --global user.name "<value>"`
- **AND** `docker compose exec -T ai-dev git config --global user.email "<value>"`
- **AND** the dashboard reflects the new values immediately by re-reading via exec

#### Scenario: Email validation
- **WHEN** the user enters an invalid email format
- **THEN** the Save button is disabled with a validation message

### Requirement: User can view git-credentials

The dashboard SHALL display stored Git credentials from ai-dev without revealing passwords by default.

#### Scenario: View stored credentials
- **WHEN** the user opens the Git credentials section
- **THEN** the backend runs `docker compose exec -T ai-dev cat ~/.git-credentials`
- **AND** parsed entries are listed
- **AND** passwords are masked with a reveal toggle per entry

#### Cross-cutting: ai-dev unavailable
- **WHEN** ai-dev container is not running
- **THEN** the Git config section shows "ai-dev container is not running"
- **AND** all forms and buttons are disabled
