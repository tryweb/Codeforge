## Purpose

Defines upgrade-time safeguards that preserve OpenChamber project registrations across image upgrades: snapshot the registration state before upgrading and reconcile missing registrations afterward so the project list survives version changes.

## Requirements

### Requirement: Upgrade snapshots OpenChamber registration state

Before recreating containers, every upgrade path SHALL copy the OpenChamber `settings.json` from the `openchamber-data` volume into the pre-upgrade backup directory used by that path — `backups/pre-<timestamp>/` for the admin UI path, `backup_<TIMESTAMP>/` for the host `upgrade.sh` path — before any container is recreated. The snapshot SHALL preserve the full `projects` array content of the file at snapshot time.

#### Scenario: Snapshot created before containers are recreated

- **WHEN** an upgrade runs and the OpenChamber `settings.json` exists
- **THEN** a copy of the file containing the current `projects` entries is written to that path's pre-upgrade backup directory before any container is recreated

#### Scenario: Snapshot retains the pre-upgrade project list

- **WHEN** the pre-upgrade registration list contains N projects and the upgrade completes
- **THEN** the snapshot file in `backups/pre-<timestamp>/` still contains exactly those N pre-upgrade project entries

### Requirement: Upgrade reconciles missing OpenChamber project registrations

After the upgrade completes, every upgrade path SHALL compare the deployment's workspace project directories against the OpenChamber registration list and re-add entries for directories that are present on disk but missing from the registration list. The reconcile SHALL be add-only and idempotent: it SHALL NOT remove any existing registration, and re-running it when nothing is missing SHALL make no changes.

#### Scenario: Missing registrations are restored after upgrade

- **WHEN** an upgrade completes and 3 workspace project directories are absent from the registration list
- **THEN** all 3 directories are re-added to the registration list and the OpenChamber UI shows them without manual action

#### Scenario: Consistent registration list is left unchanged

- **WHEN** an upgrade completes and every workspace project directory already has a registration
- **THEN** the registration list is unchanged and the reconcile reports that nothing was missing

#### Scenario: Stale registrations are never removed by the reconcile

- **WHEN** the registration list contains an entry whose directory is no longer present on disk
- **THEN** the entry is kept and the reconcile does not remove it

### Requirement: Upgrade outcome is reported in the admin UI

When an upgrade is run through the admin UI, the post-upgrade result SHALL indicate how many project registrations were restored, or that the registration list was already consistent.

#### Scenario: Admin UI upgrade reports restored registrations

- **WHEN** an admin completes an upgrade through the admin UI and the reconcile re-added 3 registrations
- **THEN** the upgrade result states that 3 project registrations were restored

#### Scenario: Admin UI upgrade reports a consistent list

- **WHEN** an admin completes an upgrade through the admin UI and the reconcile found nothing missing
- **THEN** the upgrade result states that the registration list is consistent and no registrations needed restoring

### Requirement: Snapshots follow the existing backup retention policy

The pre-upgrade OpenChamber registration snapshots SHALL be subject to the same retention cleanup as the other pre-upgrade backup directories controlled by `BACKUP_RETENTION` (`pre-*` for the admin path, `backup_*` for the host path).

#### Scenario: Old registration snapshots are cleaned up with other backups

- **WHEN** backup retention cleanup runs and a registration snapshot is older than the configured retention window
- **THEN** the snapshot is removed together with the other expired `pre-*` backups
