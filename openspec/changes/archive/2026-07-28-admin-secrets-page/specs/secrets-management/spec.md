## ADDED Requirements

### Requirement: Secrets page is accessible from navigation

The admin dashboard SHALL have a "Secrets" entry in the main navigation sidebar/header that links to `/secrets`.

#### Scenario: Navigate to Secrets page
- **WHEN** user opens the admin dashboard
- **THEN** the navigation bar SHALL display a "Secrets" link
- **THEN** clicking the link SHALL navigate to `/secrets`

### Requirement: Secrets page displays password cards

The `/secrets` page SHALL display each managed secret as an independent card containing: secret name, description, masked value with Show/Hide toggle, and its activation status.

The three managed secrets SHALL be:
- `ADMIN_PASSWORD` — Admin dashboard login password
- `OPENCHAMBER_UI_PASSWORD` — OpenChamber Web UI login password
- `OPENCODE_SERVER_PASSWORD` — OpenCode API authentication

#### Scenario: View all secrets as cards
- **WHEN** user navigates to `/secrets`
- **THEN** the page SHALL display three cards, one per managed secret
- **THEN** each card SHALL show the secret name, description, and masked value
- **THEN** each card SHALL show the activation status for that secret

#### Scenario: Secret value is masked by default
- **WHEN** the Secrets page loads
- **THEN** each password value SHALL be displayed as `●●●●●●●●` (masked)

#### Scenario: User can reveal a secret value
- **WHEN** user clicks "Show" on a secret card
- **THEN** the masked value SHALL be replaced with the actual password text
- **THEN** the button text SHALL change to "Hide"
- **WHEN** user clicks "Hide"
- **THEN** the value SHALL return to masked state

### Requirement: ADMIN_PASSWORD shows "immediate" activation status

The `ADMIN_PASSWORD` card SHALL indicate that changes take effect immediately without container restart.

#### Scenario: ADMIN_PASSWORD shows immediate effect label
- **WHEN** user views the ADMIN_PASSWORD card on `/secrets`
- **THEN** the card SHALL display a "✅ 修改後立即生效" label

### Requirement: Other secrets show "restart required" activation status

The `OPENCHAMBER_UI_PASSWORD` and `OPENCODE_SERVER_PASSWORD` cards SHALL indicate that changes require a container restart to take effect.

#### Scenario: Restart-required secrets show appropriate label
- **WHEN** user views the OPENCHAMBER_UI_PASSWORD card on `/secrets`
- **THEN** the card SHALL display a "⏳ 修改後需重啟容器才生效" label

#### Scenario: OPENCODE_SERVER_PASSWORD shows additional context note
- **WHEN** user views the OPENCODE_SERVER_PASSWORD card on `/secrets`
- **THEN** the card SHALL display an informational note explaining that OpenCode port is not exposed externally and the password is mainly for defense-in-depth

### Requirement: User can edit a secret via inline modal

Each secret card SHALL have an "Edit" button that opens an inline modal dialog for editing the password value. The modal SHALL contain a password input field and Save/Cancel buttons.

#### Scenario: Open edit modal
- **WHEN** user clicks "Edit" on a secret card
- **THEN** an inline modal SHALL appear with:
  - The secret name (read-only)
  - A password input field (type="password") pre-filled with `●●●●●●●●`
  - Cancel and Save buttons

#### Scenario: Cancel edit
- **WHEN** user clicks "Cancel" in the edit modal
- **THEN** the modal SHALL close without making any changes

#### Scenario: Save new password
- **WHEN** user enters a new password and clicks "Save"
- **THEN** the system SHALL send a `PUT /api/secrets/:key` request with the new value
- **THEN** on success, the modal SHALL close and the page SHALL reflect the updated status
- **THEN** an inline status indicator SHALL show the activation message for that secret

#### Scenario: Save with empty value
- **WHEN** user attempts to save an empty password value
- **THEN** the system SHALL return a 400 error
- **THEN** the modal SHALL display the error message and remain open

### Requirement: GET /api/secrets returns secret metadata only

The `GET /api/secrets` endpoint SHALL return a JSON array of secret objects. Each object SHALL include `key`, `description`, `hasValue`, `activationStatus`, and optionally `note`. The actual password values SHALL NOT be included in this response.

#### Scenario: Fetch secrets list
- **WHEN** system calls `GET /api/secrets`
- **THEN** the response SHALL be a 200 JSON array
- **THEN** each entry SHALL contain `key`, `description`, `hasValue` (boolean), and `activationStatus` (string)
- **THEN** the response SHALL NOT contain actual password values

### Requirement: PUT /api/secrets/:key updates a secret value

The `PUT /api/secrets/:key` endpoint SHALL accept a JSON body with `value` and update the corresponding key in the `.env` file. It SHALL return the activation status for the updated secret.

#### Scenario: Update secret successfully
- **WHEN** system calls `PUT /api/secrets/ADMIN_PASSWORD` with `{"value": "new-password-123"}`
- **THEN** the system SHALL update the `.env` file with the new value
- **THEN** the response SHALL be `200` with `{"ok": true, "activationStatus": "immediate"}`

#### Scenario: Update non-secret key returns 404
- **WHEN** system calls `PUT /api/secrets/NONEXISTENT_KEY` with a valid value
- **THEN** the response SHALL be `404`

#### Scenario: Update with non-string value returns 400
- **WHEN** system calls `PUT /api/secrets/ADMIN_PASSWORD` with `{"value": null}`
- **THEN** the response SHALL be `400` with an error message

### Requirement: Secrets page is protected by auth middleware

The `/secrets` route and `/api/secrets` endpoints SHALL be protected by the same auth middleware as all other admin routes.

#### Scenario: Unauthenticated access to /secrets redirects to login
- **WHEN** an unauthenticated user requests `GET /secrets`
- **THEN** the system SHALL redirect to `/login`

#### Scenario: Unauthenticated access to /api/secrets returns 401
- **WHEN** an unauthenticated system calls `GET /api/secrets`
- **THEN** the response SHALL be `401 Unauthorized`
