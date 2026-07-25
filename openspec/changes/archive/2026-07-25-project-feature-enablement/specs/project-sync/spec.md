## ADDED Requirements

### Requirement: Detect inconsistencies between admin and OpenChamber
The system SHALL expose a `GET /api/projects/sync` endpoint that compares workspace directories against OpenChamber's project registry and returns differences.

#### Scenario: Project exists in workspace but not in OpenChamber
- **WHEN** a directory exists in `~/workspace/` but has no matching entry in OpenChamber's `settings.json` `projects` array
- **THEN** the endpoint includes that project name in `missingInOC` array

#### Scenario: OpenChamber entry has no matching workspace directory
- **WHEN** an OpenChamber project entry points to a path under `~/workspace/` that no longer exists on disk
- **THEN** the endpoint includes that project name in `staleInOC` array

#### Scenario: All projects in sync
- **WHEN** every workspace directory has a matching OpenChamber entry and vice versa
- **THEN** the endpoint returns `{"missingInOC": [], "staleInOC": []}`

### Requirement: Batch fix inconsistencies
The system SHALL expose a `POST /api/projects/sync` endpoint that accepts add/remove lists and applies changes to OpenChamber's settings.json.

#### Scenario: Add missing projects
- **WHEN** `POST /api/projects/sync` with `{"add": ["project-a", "project-b"], "remove": []}`
- **THEN** each project is added to OpenChamber's `settings.json` `projects` array with its path and base64-encoded ID

#### Scenario: Remove stale entries
- **WHEN** `POST /api/projects/sync` with `{"add": [], "remove": ["old-project"]}`
- **THEN** the entry with matching path is removed from OpenChamber's `settings.json` `projects` array
