## ADDED Requirements

### Requirement: Dashboard displays existing SSH keys

The ai-admin dashboard SHALL list SSH keys present in ai-dev's `~/.ssh/` via exec.

#### Scenario: List SSH keys
- **WHEN** the user opens the SSH keys section
- **THEN** the backend runs `docker compose exec -T ai-dev ls -la ~/.ssh/`
- **AND** parses files matching `id_*` and `*.pub`
- **AND** for each key pair, runs `docker compose exec -T ai-dev ssh-keygen -lf ~/.ssh/<key>` to get the fingerprint
- **AND** the key type, fingerprint, and comment are displayed

#### Scenario: No SSH keys
- **WHEN** no SSH keys exist in ai-dev's `~/.ssh/`
- **THEN** the dashboard shows "No SSH keys found" with a "Generate New Key" button

### Requirement: User can generate a new SSH key

The dashboard SHALL generate a new SSH key pair inside ai-dev via exec.

#### Scenario: Generate key
- **WHEN** the user provides an email/comment and clicks "Generate"
- **THEN** the backend runs `docker compose exec -T ai-dev ssh-keygen -t ed25519 -C "<comment>" -f ~/.ssh/id_ed25519 -N ""`
- **AND** then runs `docker compose exec -T ai-dev cat ~/.ssh/id_ed25519.pub` to retrieve the public key
- **AND** the public key content is displayed with a "Copy to clipboard" button

#### Scenario: Key type selection
- **WHEN** generating a key
- **THEN** the user can choose between `ed25519` (default) and `rsa` (4096-bit)

### Requirement: User can view public key

The dashboard SHALL display the public key content from ai-dev with a copy button.

#### Scenario: View public key
- **WHEN** the user clicks "View" on an existing key
- **THEN** the backend runs `docker compose exec -T ai-dev cat ~/.ssh/<key>.pub`
- **AND** the full public key content is displayed in a monospace block
- **AND** a "Copy" button copies the key to clipboard

#### Cross-cutting: ai-dev unavailable
- **WHEN** ai-dev container is not running
- **THEN** the SSH keys section shows "ai-dev container is not running"
- **AND** the "Generate New Key" and "View" buttons are disabled
