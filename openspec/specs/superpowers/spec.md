## Purpose

Enables per-project opt-in for SuperPower skills via admin UI, replacing the current global installation that forces all 14 skills on every workspace.

## Requirements

### Requirement: Admin can enable SuperPower for a specific project

The system SHALL allow an admin to enable SuperPower on a selected project via the admin UI.

#### Scenario: Enable SuperPower from project drawer
- **WHEN** admin clicks "Enable" on the SuperPower capability row for a project
- **THEN** the backend creates project-level `.opencode/opencode.json` with SuperPower plugin and symlinks skills to `.opencode/skills/`
- **THEN** the UI updates to show SuperPower as "Enabled" with a green badge

#### Scenario: Enable SuperPower via API
- **WHEN** POST `/api/projects/:name/features/superpowers` is called
- **THEN** response 200 with `{ "enabled": true, "feature": "superpowers" }`
- **THEN** project directory contains `.opencode/opencode.json` with `"plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]`
- **THEN** project directory contains `.opencode/skills/` with symlinks to all 14 SuperPower skill directories

### Requirement: Project-level SuperPower configuration is detected correctly

The system SHALL detect whether SuperPower is enabled for a project by checking for the project-level OpenCode config.

#### Scenario: Project overview shows SuperPower status
- **WHEN** GET `/api/projects/overview` is called
- **THEN** response includes `"superpowers": true` for projects with `.opencode/opencode.json` containing SuperPower plugin
- **THEN** response includes `"superpowers": false` for projects without the config

#### Scenario: Project feature status endpoint
- **WHEN** GET `/api/projects/:name/features` is called
- **THEN** response includes `"superpowers": true/false` matching actual filesystem state

### Requirement: SuperPower skills are available in OpenCode for enabled projects

The system SHALL make SuperPower skills discoverable by OpenCode when a project has SuperPower enabled.

#### Scenario: OpenCode session loads project with SuperPower enabled
- **WHEN** OpenCode starts in a project directory with `.opencode/opencode.json` containing SuperPower plugin
- **THEN** OpenCode loads the SuperPower plugin and its 14 skills
- **THEN** skills are available via `/skill` command and auto-injection

### Requirement: SuperPower is not globally enabled by default

The system SHALL NOT install SuperPower as a global plugin in the base container image.

#### Scenario: Fresh container has no global SuperPower
- **WHEN** container starts with rebuilt image
- **THEN** `OPENCODE_PLUGINS` env var does not contain `superpowers@...`
- **THEN** generated `~/.config/opencode/opencode.json` does not list SuperPower in plugins
- **THEN** no SuperPower skills are symlinked to `~/.config/opencode/skills/`

### Requirement: Disabling SuperPower removes project-level config

The system SHALL allow disabling SuperPower for a project, cleaning up the project-level configuration.

#### Scenario: Disable SuperPower via admin UI
- **WHEN** admin clicks "Disable" on SuperPower capability for a project
- **THEN** backend removes `.opencode/opencode.json` and `.opencode/skills/` symlinks
- **THEN** GET `/api/projects/:name/features` returns `"superpowers": false`
