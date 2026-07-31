## Purpose

Lets administrators manage AI provider definitions through a structured dashboard UI backed by the `OPENCODE_PROVIDER` env var, instead of hand-editing raw single-line JSON in the env editor.

## ADDED Requirements

### Requirement: Admin can list providers
The admin Providers page SHALL display every provider defined in the `OPENCODE_PROVIDER` env var as a card. The provider list API SHALL return provider metadata (name, npm package, baseURL, whether an API key is set) and SHALL NOT return API key values.

#### Scenario: Providers page shows defined providers
- **WHEN** `OPENCODE_PROVIDER` contains valid JSON with two providers
- **THEN** the Providers page shows two provider cards with their metadata and masked API key placeholders

#### Scenario: Invalid or absent OPENCODE_PROVIDER
- **WHEN** `OPENCODE_PROVIDER` is unset, empty, or not valid JSON
- **THEN** the Providers page shows an empty state (and for invalid JSON, a visible validation notice) instead of an error page

### Requirement: Admin can create and update a provider
The admin SHALL be able to add a new provider and edit an existing provider's structured fields: display name, npm package, baseURL, and API key (optional). Saving SHALL write the full provider set back to `OPENCODE_PROVIDER` as valid single-line JSON.

#### Scenario: Saving a provider updates the env var
- **WHEN** an admin saves a provider with a name, npm package, and baseURL
- **THEN** the API returns 200 and `OPENCODE_PROVIDER` in `.env` contains the updated provider set as valid single-line JSON

#### Scenario: Invalid provider data is rejected
- **WHEN** an admin submits a provider that is not valid JSON or violates the provider object shape (npm/options/models not objects where required)
- **THEN** the API returns 400 with an error message and the `.env` file is unchanged

#### Scenario: Provider card includes raw JSON fallback
- **WHEN** an admin edits the advanced fields (models, options) of a provider
- **THEN** the provider card offers a raw JSON editor for those fields, and invalid raw JSON is rejected with 400

### Requirement: Admin can delete a provider
The admin SHALL be able to remove a provider. Removing the last provider SHALL remove the `OPENCODE_PROVIDER` variable from `.env` entirely.

#### Scenario: Deleting a provider
- **WHEN** an admin deletes an existing provider
- **THEN** the API returns 200 and the provider key is gone from `OPENCODE_PROVIDER`

#### Scenario: Deleting a nonexistent provider
- **WHEN** an admin deletes a provider that does not exist
- **THEN** the API returns 404

#### Scenario: Deleting the last provider
- **WHEN** an admin deletes the only remaining provider
- **THEN** `OPENCODE_PROVIDER` is removed from `.env`

### Requirement: Provider changes require restart to apply
Provider definition changes SHALL take effect only after a container restart (the entrypoint regenerates `opencode.json` from `OPENCODE_PROVIDER` at boot). The Providers page SHALL surface this activation requirement and reuse the existing restart flow.

#### Scenario: Page shows restart requirement after save
- **WHEN** an admin saves a provider change
- **THEN** the UI indicates the change requires a restart and offers the existing "Restart ai-dev" action

#### Scenario: Restart applies provider changes
- **WHEN** an admin confirms the restart after saving provider changes
- **THEN** the ai-dev container is recreated (production) or restarted (dev/DooD) via the existing env restart endpoint, and the regenerated `opencode.json` contains the updated providers
