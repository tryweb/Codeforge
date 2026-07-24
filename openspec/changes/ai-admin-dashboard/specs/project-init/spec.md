## ADDED Requirements

### Requirement: User can create a new OpenCode project

The ai-admin dashboard SHALL allow users to create new project directories in ai-dev's workspace, via exec.

#### Scenario: Create project via form
- **WHEN** the user fills in the project name (and optional description) and clicks "Create"
- **THEN** the backend runs `docker compose exec -T ai-dev mkdir -p ~/workspace/<project-name>`
- **AND** `docker compose exec -T ai-dev opencode --new --name <project-name> ~/workspace/<project-name>`
- **AND** a success message is shown with a path to the new project

#### Scenario: Project name validation
- **WHEN** the user enters a project name with invalid characters (spaces, slashes, special chars)
- **THEN** an inline error is shown: "Project name must be kebab-case (letters, numbers, hyphens)"
- **AND** the Create button remains disabled

#### Scenario: Duplicate project name
- **WHEN** the user enters a project name that already exists in the workspace
- **THEN** the backend runs `docker compose exec -T ai-dev test -d ~/workspace/<project-name>`
- **AND** if it returns 0, a warning is shown: "Project 'foo' already exists. Overwrite .opencode.json?"
- **AND** the user can confirm to re-initialize or cancel

### Requirement: List existing projects

The dashboard SHALL list existing project directories in ai-dev's workspace.

#### Scenario: Workspace listing
- **WHEN** the user opens the project section
- **THEN** the backend runs `docker compose exec -T ai-dev ls -1 ~/workspace/`
- **AND** for each directory, runs `docker compose exec -T ai-dev test -f ~/workspace/<dir>/.opencode.json && echo "has_config" || echo "no_config"`
- **AND** displays each directory name, last modified time, and whether it has an `.opencode.json`

#### Cross-cutting: ai-dev unavailable
- **WHEN** ai-dev container is not running
- **THEN** the projects section shows "ai-dev container is not running"
- **AND** the create and list buttons are disabled
