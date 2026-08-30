## Purpose

Enables per-project opt-in for SuperPower skills via admin UI, replacing the current global installation that forces all 14 skills on every workspace.

## Requirements

### Requirement: Admin can enable SuperPower for a specific project

The system SHALL allow an admin to enable SuperPower on a selected project via the admin UI. Enabling symlinks the 14 SuperPower skills baked into the image (`/opt/opencode/baked-plugins/superpowers/skills/`) into the project's `.opencode/skills/` and creates a `.opencode/superpowers` marker directory. The SuperPower plugin is NOT declared in a project `opencode.json`: the image bakes the plugin at `/opt/opencode/baked-plugins/superpowers/` (git-installed plugin declarations are wiped by the opencode plugin-cache volume), and project-level skills are loaded natively by OpenCode.

#### Scenario: Enable SuperPower from project drawer
- **WHEN** admin clicks "Enable" on the SuperPower capability row for a project
- **THEN** the backend symlinks all 14 SuperPower skill directories from the baked image into the project's `.opencode/skills/` and creates the `.opencode/superpowers` marker directory
- **THEN** the UI updates to show SuperPower as "Enabled" with a green badge

#### Scenario: Enable SuperPower via API
- **WHEN** POST `/api/projects/:name/features/superpowers` is called
- **THEN** response 200 with the shared feature-endpoint success shape (`{ "ok": true }`)
- **THEN** project directory contains `.opencode/skills/` with symlinks to all 14 baked SuperPower skill directories
- **THEN** project directory contains the `.opencode/superpowers` marker directory

### Requirement: Project-level SuperPower configuration is detected correctly

The system SHALL detect whether SuperPower is enabled for a project by checking for the project-level `.opencode/superpowers` marker directory (the actual filesystem state written by enable).

#### Scenario: Project overview shows SuperPower status
- **WHEN** GET `/api/projects/overview` is called
- **THEN** response includes `"superpowers": true` for projects whose `.opencode/superpowers` marker directory exists
- **THEN** response includes `"superpowers": false` for projects without the marker

#### Scenario: Project feature status endpoint
- **WHEN** GET `/api/projects/:name/features` is called
- **THEN** response includes `"superpowers": true/false` matching actual filesystem state

### Requirement: SuperPower skills are available in OpenCode for enabled projects

The system SHALL make the 14 SuperPower skills discoverable by OpenCode when a project has SuperPower enabled, via the project-level `.opencode/skills/` directory (scanned natively by OpenCode). The SuperPower plugin itself is baked into the image but is not loaded per-project; the symlinked skills are the usable surface.

#### Scenario: OpenCode session loads project with SuperPower enabled
- **WHEN** OpenCode starts in a project directory whose `.opencode/skills/` contains the symlinked SuperPower skills
- **THEN** OpenCode registers and loads all 14 SuperPower skills
- **THEN** skills are available via `/skill` command and auto-injection

### Requirement: SuperPower is not globally enabled by default

The system SHALL NOT install SuperPower as a global plugin. The image bakes the SuperPower repository at `/opt/opencode/baked-plugins/superpowers/` solely as the symlink source for per-project enablement; no global plugin declaration or skill symlink references it.

#### Scenario: Fresh container has no global SuperPower
- **WHEN** container starts with rebuilt image
- **THEN** `OPENCODE_PLUGINS` env var does not contain `superpowers@...`
- **THEN** generated `~/.config/opencode/opencode.json` does not list SuperPower in plugins
- **THEN** no SuperPower skills are symlinked to `~/.config/opencode/skills/`

### Requirement: Disabling SuperPower removes project-level config

The system SHALL allow disabling SuperPower for a project, cleaning up the project-level configuration.

#### Scenario: Disable SuperPower via admin UI
- **WHEN** admin clicks "Disable" on SuperPower capability for a project
- **THEN** backend removes the `.opencode/superpowers` marker directory and the SuperPower skill symlinks from `.opencode/skills/` (symlinks whose target lives under the baked `superpowers` path; unrelated symlinks are left untouched)
- **THEN** GET `/api/projects/:name/features` returns `"superpowers": false`
