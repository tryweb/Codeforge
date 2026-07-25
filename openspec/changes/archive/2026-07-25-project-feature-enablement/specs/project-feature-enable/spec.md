## ADDED Requirements

### Requirement: Feature enable endpoint
The system SHALL expose a `POST /api/projects/:name/features/:feature` endpoint that triggers bootstrap for the specified feature on the given project.

#### Scenario: Enable knowledge base
- **WHEN** `POST /api/projects/my-app/features/knowledge` is called
- **THEN** the system runs `bash ~/.config/opencode/skills/enable-project-knowledge/bootstrap.sh /home/devuser/workspace/my-app` inside the ai-dev container
- **THEN** the endpoint returns HTTP 200 with the bootstrap script output

#### Scenario: Enable maintenance reports
- **WHEN** `POST /api/projects/my-app/features/maintenance` is called
- **THEN** the system runs `bash ~/.config/opencode/skills/enable-finalize-maintenance/bootstrap.sh /home/devuser/workspace/my-app` inside the ai-dev container
- **THEN** the endpoint returns HTTP 200 with the bootstrap script output

#### Scenario: Initialize OpenSpec
- **WHEN** `POST /api/projects/my-app/features/openspec` is called
- **THEN** the system runs `openspec init --tools opencode --force /home/devuser/workspace/my-app` inside the ai-dev container
- **THEN** the endpoint returns HTTP 200 with the command output

#### Scenario: Invalid feature name
- **WHEN** `POST /api/projects/my-app/features/invalid` is called
- **THEN** the endpoint returns HTTP 400 with an error message listing valid feature names

### Requirement: Bootstrap commands run inside ai-dev container
The system SHALL execute all bootstrap commands via `execInAiDev` with adequate timeouts.

#### Scenario: Timeout handling
- **WHEN** a bootstrap script takes longer than 30 seconds
- **THEN** the admin API returns HTTP 500 with a timeout error

### Requirement: Auto-provision of knowledge dependency
When `enable-finalize-maintenance` bootstrap runs and knowledge base is not yet enabled, the bootstrap.sh script SHALL automatically invoke `enable-project-knowledge` first (this is already implemented in the bootstrap.sh — the admin endpoint does not need to handle this ordering).

#### Scenario: Maintenance with missing knowledge
- **WHEN** `enable-finalize-maintenance/bootstrap.sh` runs on a project without `docs/knowledge/README.md`
- **THEN** the script automatically calls `enable-project-knowledge/bootstrap.sh` before creating its own files
