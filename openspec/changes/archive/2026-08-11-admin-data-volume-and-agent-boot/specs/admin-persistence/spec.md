## Purpose

Defines the persistent home for ai-admin runtime state: the `admin-data` directory mount under `/opt/ai-engkit`, which survives container recreation so admin-managed files (provider key registry, mTLS CA certificate, future additions) are not lost on version update or restart.

## ADDED Requirements

### Requirement: Admin state persists in the admin-data directory

The ai-admin runtime SHALL persist its own state files — the provider key registry and the mTLS CA certificate — under `/opt/ai-engkit/admin-data`, a directory that is mounted from the host in production and from the `admin-data-dev` named volume in dev. Files SHALL survive admin container recreation from any source (version update, `docker compose up -d --force-recreate`, reboot). No admin credential or state file SHALL be written to the container-local filesystem outside this directory, the `.env` file, or the `backups` directory.

#### Scenario: Provider registry survives recreation
- **WHEN** the admin container is recreated and the registry file exists under `/opt/ai-engkit/admin-data`
- **THEN** all stored provider keys and the active selection are still present

#### Scenario: mTLS CA certificate survives recreation
- **WHEN** an embedded CA certificate from a registration URL has been written to `/opt/ai-engkit/admin-data/center-ca.pem`
- **THEN** the file is still present after the admin container is recreated

### Requirement: Upgrade paths migrate the legacy provider-state directory

When `admin-data` is introduced, both host-side upgrade entry points (`install.sh` and `upgrade.sh`) SHALL create the `admin-data` directory and move an existing `provider-state/provider-keys.json` into it before recreating containers. A legacy file that cannot be moved cleanly SHALL be preserved with a timestamped suffix, never deleted.

#### Scenario: Existing registry is migrated
- **WHEN** an installation is upgraded from a version that stored the registry at `provider-state/provider-keys.json`
- **THEN** the registry file is moved to `admin-data/provider-keys.json` and all keys remain available

#### Scenario: Pre-upgrade backup includes the registry
- **WHEN** an upgrade runs via the admin UI
- **THEN** the pre-upgrade backup snapshot includes the provider key registry alongside the `.env` and compose files
