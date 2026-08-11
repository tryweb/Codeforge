## MODIFIED Requirements

### Requirement: Key registry persistence
API keys SHALL be stored per provider in a dedicated registry file (`admin-data/provider-keys.json`), never in the `.env` file. The registry SHALL record the ordered list of keys for each provider and which key (if any) is active.

#### Scenario: Registry file is the single store
- **WHEN** an admin adds a key for a provider
- **THEN** the key is appended to `admin-data/provider-keys.json` and no provider credential is written to `.env`

#### Scenario: Registry survives admin restart
- **WHEN** the admin container restarts
- **THEN** all stored keys and the active selection are still present (production bind mount; dev `admin-data-dev` named volume)
