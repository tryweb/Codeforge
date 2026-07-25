## ADDED Requirements

### Requirement: Feature status query
The system SHALL expose a `GET /api/projects/:name/features` endpoint that returns the enablement status of all three project features for a given project.

#### Scenario: All features disabled
- **WHEN** a project has no `docs/knowledge/README.md`, no `docs/knowledge/maintenance/README.md`, and no `openspec/` directory
- **THEN** the endpoint returns `{"knowledge": false, "maintenance": false, "openspec": false}`

#### Scenario: Knowledge base enabled
- **WHEN** a project has `docs/knowledge/README.md` present
- **THEN** the endpoint returns `"knowledge": true`

#### Scenario: Maintenance enabled
- **WHEN** a project has `docs/knowledge/maintenance/README.md` present
- **THEN** the endpoint returns `"maintenance": true`

#### Scenario: OpenSpec initialized
- **WHEN** a project has an `openspec/` directory
- **THEN** the endpoint returns `"openspec": true`

#### Scenario: Project does not exist
- **WHEN** a project name does not correspond to a directory in `~/workspace/`
- **THEN** the endpoint returns HTTP 404 with an error message

### Requirement: Feature status is checked inside ai-dev container
The system SHALL run status checks via `execInAiDev` using `test -f` / `test -d` on the project's absolute path inside the ai-dev container.

#### Scenario: Status check command
- **WHEN** checking knowledge status for project "my-app"
- **THEN** the system runs `test -f /home/devuser/workspace/my-app/docs/knowledge/README.md && echo yes` inside the ai-dev container
