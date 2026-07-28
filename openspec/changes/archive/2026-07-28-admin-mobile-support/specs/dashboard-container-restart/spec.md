## ADDED Requirements

### Requirement: Restart ai-dev from dashboard

The dashboard page SHALL provide a "Restart ai-dev" action that restarts the ai-dev container via the existing restart endpoint (`POST /api/env/restart`). The action SHALL require explicit confirmation before executing and SHALL display status feedback during and after the operation.

#### Scenario: Confirmation required before restart

- **WHEN** the user taps the "Restart ai-dev" button on the dashboard
- **THEN** a confirmation dialog is shown, and no restart request is sent unless the user confirms

#### Scenario: Restart executes after confirmation

- **WHEN** the user confirms the restart dialog
- **THEN** the dashboard sends `POST /api/env/restart` and displays a "Restarting..." status indication

#### Scenario: Successful restart feedback

- **WHEN** the restart request completes successfully
- **THEN** the dashboard displays a success indication (e.g., "Restarted ✔")

#### Scenario: Failed restart feedback

- **WHEN** the restart request fails or returns an error
- **THEN** the dashboard displays an error indication and the button returns to its actionable state

#### Scenario: Parity with env editor restart

- **WHEN** the dashboard "Restart ai-dev" action is used in either production or dev (DooD) deployment mode
- **THEN** it behaves identically to the env editor's restart action, because both call the same endpoint
