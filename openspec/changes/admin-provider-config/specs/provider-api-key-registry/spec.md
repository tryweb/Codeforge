## Purpose

Lets administrators store multiple API keys per AI provider and manually select which key is active; the active key is applied to the running container's opencode auth store so the provider connects with the chosen credential.

## ADDED Requirements

### Requirement: Key registry persistence
API keys SHALL be stored per provider in a dedicated registry file (`provider-keys.json`), never in the `.env` file. The registry SHALL record the ordered list of keys for each provider and which key (if any) is active.

#### Scenario: Registry file is the single store
- **WHEN** an admin adds a key for a provider
- **THEN** the key is appended to `provider-keys.json` and no provider credential is written to `.env`

#### Scenario: Registry survives admin restart
- **WHEN** the admin container restarts
- **THEN** all stored keys and the active selection are still present (production bind mount; dev container-local file)

### Requirement: Key values are masked in the API
The key list API SHALL return masked key identifiers and the active flag, and SHALL NOT return plaintext key values. Plaintext SHALL be returned only on an explicit per-key request.

#### Scenario: List does not leak key values
- **WHEN** the admin loads the provider page
- **THEN** the key list shows masked entries (e.g. last-4 suffix) and no plaintext key appears in the API response

#### Scenario: Reveal on demand
- **WHEN** an admin clicks Show on a specific key
- **THEN** the API returns the plaintext for that single key only

### Requirement: Admin can add and remove keys
The admin SHALL be able to add a new key to a provider and delete an existing key. Deleting the active key SHALL promote the next key to active, or leave the provider with no active key if it was the last one.

#### Scenario: Adding a key
- **WHEN** an admin submits a new key for a provider
- **THEN** the key is added to the registry and the current active selection is unchanged

#### Scenario: Deleting the active key
- **WHEN** an admin deletes the active key of a provider that has more than one key
- **THEN** the next key in the list becomes active

#### Scenario: Deleting the last key
- **WHEN** an admin deletes the only key of a provider
- **THEN** the provider has no active key and no keys in the registry

#### Scenario: Deleting the active key of a key-managed provider
- **WHEN** an admin deletes the active key of a supported provider (e.g. `opencode-go`) that has more than one key
- **THEN** the promoted key is applied to the opencode auth store and the opencode server restarts

#### Scenario: Deleting the last key of a key-managed provider
- **WHEN** an admin deletes the only key of a supported provider (e.g. `opencode-go`)
- **THEN** the provider's entry is removed from the opencode auth store, the provider cache is cleared, and the opencode server restarts

### Requirement: Admin can select the active key
The admin SHALL be able to mark any stored key as active for a provider. The selection SHALL persist in the registry.

#### Scenario: Selecting a different key
- **WHEN** an admin selects key B while key A is active
- **THEN** the registry marks key B active and key A inactive

### Requirement: Applying the active key to the opencode auth store
Selecting the active key for a supported provider (initially `opencode-go`) SHALL apply it to the running ai-dev container: write the key into `~/.local/share/opencode/auth.json`, clear the oh-my-opencode provider cache, and restart the opencode server so the plugin's provider probe picks up the new credential.

#### Scenario: Successful apply
- **WHEN** an admin selects an active key for `opencode-go` and the ai-dev container is reachable
- **THEN** `auth.json` in the ai-dev container contains the selected key, the oh-my-opencode provider cache is cleared, the opencode server restarts, and the UI reports success

#### Scenario: Apply failure is reported
- **WHEN** the ai-dev container is unreachable or the apply step fails
- **THEN** the API returns an error, the selection is not applied, and the UI shows the failure reason

### Requirement: First-run import of an existing key
When the registry has no keys for a provider but the ai-dev container's `auth.json` already contains a key for it, the admin SHALL be able to import that key as the first registry entry and mark it active.

#### Scenario: Importing the existing opencode-go key
- **WHEN** the registry is empty for `opencode-go` and `auth.json` contains an `opencode-go` key
- **THEN** the Providers page offers an import action that creates registry entry #1 with that key marked active

#### Scenario: No duplicate import
- **WHEN** the registry already contains keys for `opencode-go`
- **THEN** the import action is not offered and existing keys are untouched
