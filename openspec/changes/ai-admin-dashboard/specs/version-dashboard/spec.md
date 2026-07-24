## ADDED Requirements

### Requirement: Dashboard displays pinned component versions

The ai-admin dashboard SHALL display the current versions of all major components in the running image.

#### Scenario: Version dashboard loads
- **WHEN** the user navigates to the version dashboard
- **THEN** a table is displayed with columns: Component, Installed Version, Build Arg (if pinned)
- **AND** the following components are listed: OpenCode, OpenChamber, Docker, Docker Compose, gh, glab, lean-ctx, Playwright, Bun, Homebrew, marksman, oh-my-openagent

#### Scenario: Version sourced from CLI output
- **WHEN** the component is a CLI tool (gh, glab, git, docker)
- **THEN** the version is obtained by running `<command> --version` inside the container

#### Scenario: Version sourced from image label or build-arg
- **WHEN** the component is pinned via a Docker build ARG
- **THEN** the build-time value is displayed alongside the runtime version for comparison

#### Scenario: Version check failure
- **WHEN** a component's version command fails or times out
- **THEN** that component shows "unavailable" with an error icon
- **AND** other component versions continue to display normally

### Requirement: Image build date and digest display

The dashboard SHALL display the image creation timestamp and digest.

#### Scenario: Image metadata shown
- **WHEN** the version dashboard loads
- **THEN** the image tag, digest, and creation date are shown at the top of the page
