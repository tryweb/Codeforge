# Spec: omo-config-persistence

## ADDED Requirements

### Requirement: Persistent volume for ~/.omo
`docker-compose.yml` and `docker-compose.dev.yml` SHALL each define a named volume (e.g. `omo-config`) mounted at `/home/devuser/.omo` in the `ai-dev` service, so omo.jsonc, migration markers, backups, and the migration lock survive container recreation.

Before OMO starts, the entrypoint SHALL archive recognized legacy config files inside the separate `opencode-config` volume. This prevents OMO from attempting a cross-volume legacy migration.

#### Scenario: omo.jsonc survives container recreate
- **WHEN** a container is removed and recreated with the same named volume
- **THEN** `~/.omo/omo.jsonc` (including user edits and the `_migrations` marker) is present and unchanged

#### Scenario: Migration does not re-run after recreate
- **WHEN** a container is recreated after OMO's startup migration has previously completed
- **THEN** opencode startup does not run the legacy-config migration, no OMO migration backup is created, and no unfinished migration journal exists

### Requirement: Volume ownership and writability
The mounted `~/.omo` directory SHALL be owned by the container's `devuser` and writable at container start, so OMO can acquire `~/.omo/.migration.lock` and write omo.jsonc without permission errors.

#### Scenario: Fresh volume has correct ownership
- **WHEN** a container starts with a freshly created `omo-config` volume
- **THEN** `/home/devuser/.omo` is owned by `devuser` and the entrypoint plus OMO migration can write to it
