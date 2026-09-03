## Purpose

Provide a structured, Admin-managed contract for the LSP (Language Server Protocol) servers that OpenCode uses, in which the Docker image defines the supported server catalog and defaults, the Admin UI manages per-server enablement and version pinning with live npm version discovery, and container lifecycle events preserve the operator's effective configuration.

## Requirements

### Requirement: Docker image baseline defines the supported LSP catalog

The system SHALL expose a catalog of the OpenCode-facing, bun/npm-installable LSP servers that AI-EngKit supports, packaged with the Docker image as the canonical default. Each catalog entry SHALL include its npm package name, its launch command, the file extensions it serves, and an enablement default. The set of controlled LSP servers is exactly the set of catalog entries that are enabled through the user-override layer; the generated OpenCode `lsp` block is one product of that state.

#### Scenario: Admin lists the supported catalog
- **WHEN** the Admin LSP page is opened with no user override
- **THEN** each supported LSP server is listed with its npm package, launch command, extensions, and default enablement state from the image baseline

#### Scenario: Only OpenCode-facing servers are controlled
- **WHEN** a tool is not a language server that OpenCode launches (for example a pure CLI)
- **THEN** it is not offered in the Admin LSP page

### Requirement: per-server enablement and version are persisted as user overrides

The system SHALL persist an operator's per-server `enabled` toggle and pinned `version` as a user-override layer separate from the image baseline. An omitted version SHALL mean "latest". Persisted overrides SHALL survive container recreation and restart. Startup SHALL NOT overwrite existing user overrides with image defaults.

#### Scenario: Toggling enablement persists
- **WHEN** an operator disables a catalog LSP server and saves
- **THEN** that server is omitted from the generated OpenCode `lsp` block on the next configuration generation and the override persists across restart

#### Scenario: Built-in-backed servers stay managed
- **WHEN** an operator disables `typescript`, `yaml-ls`, or `pyright`
- **THEN** the override layer normalizes the server to managed (`enabled: true`), keeping any pinned version

#### Scenario: Pin persists and is preserved on restart
- **WHEN** an operator pins a server to a specific version and restarts the container
- **THEN** the pinned version remains the configured version and the generated configuration reflects it

#### Scenario: Unpinned server tracks latest
- **WHEN** an operator leaves a server's version unset
- **THEN** the server installs and resolves through the floating latest channel

### Requirement: Discover published versions from the npm registry

The Admin SHALL discover the published versions of each catalog LSP package from the public npm registry and SHALL expose them to the operator as selectable choices. The Admin SHALL clearly mark updates that are newer than the currently pinned or installed version.

#### Scenario: Published versions are listed
- **WHEN** the Admin requests available versions for a catalog LSP package
- **THEN** the system returns the published versions, newest first, with the current / pinned version identified

#### Scenario: Registry is unreachable
- **WHEN** npm registry discovery fails
- **THEN** the Admin exposes an actionable error and no version is selected or guessed automatically

#### Scenario: A newer version is available
- **WHEN** a server is pinned to an older version and a newer published version exists
- **THEN** the Admin marks that a newer version is available

### Requirement: Install, upgrade, and pin through the package manager

The system SHALL install, upgrade, and pin catalog LSP servers through the bun global package manager using the existing container startup install path. A pinned server SHALL install at its pinned version; an unpinned enabled server SHALL install at latest. The system SHALL report the result of each install/upgrade action.

#### Scenario: Installing an enabled server
- **WHEN** an operator enables and saves a catalog server that is not yet installed
- **THEN** the server is installed on the next apply, and the result is reported to the operator

#### Scenario: Upgrading to a selected version
- **WHEN** an operator selects a pinned version and applies
- **THEN** the server is installed at that version and the operator is informed of success or failure

#### Scenario: Installing an unavailable packet
- **WHEN** an install or upgrade action fails
- **THEN** the system reports the failure output and leaves the previously effective state unchanged

### Requirement: Reconcile desired catalog against observed state

The system SHALL reconcile the desired catalog (image baseline plus user overrides) against the observed state (which catalog servers are installed and at which versions, and which appear in the generated OpenCode `lsp` block). Reconciliation SHALL happen on an operator-triggered apply and SHALL report a summary of what changed, applied, and failed.

#### Scenario: Apply reconciles enablement
- **WHEN** an enabled server is missing from the generated OpenCode `lsp` block
- **THEN** reconciliation adds it, and the summary reports the change

#### Scenario: Apply reconciles a version mismatch
- **WHEN** an installed server's version differs from the pinned desired version
- **THEN** reconciliation upgrades or downgrades it to the pinned version and reports the change

#### Scenario: Apply reports a no-op
- **WHEN** the observed state already matches the desired catalog
- **THEN** reconciliation reports no changes

### Requirement: Protect Admin operations

The Admin LSP endpoints SHALL be protected by the existing Admin authentication and SHALL not change server state when discovery, validation, or reconciliation fails.

#### Scenario: Unauthenticated access is rejected
- **WHEN** a request without a valid Admin session accesses the LSP endpoints
- **THEN** the system rejects the request according to the existing Admin authentication behavior

#### Scenario: Failed reconcile leaves state unchanged
- **WHEN** an install or upgrade action fails before the persist step
- **THEN** the persisted configuration is unchanged
