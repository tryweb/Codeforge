## Purpose

Give Admin operators a clear and safe way to upgrade to the current official release or choose a specific formal AI-EngKit release.

## Requirements

### Requirement: Discover formal releases from GHCR

The system SHALL obtain image tags from the public GHCR OCI Distribution API and SHALL expose only formal `v1.x.y` release tags in the version selector.

#### Scenario: Formal release list is returned

- **WHEN** the Admin requests available upgrade versions
- **THEN** the system returns formal `v1.x.y` tags ordered from highest semantic version to lowest

#### Scenario: Non-release tags are excluded

- **WHEN** GHCR returns tags such as `latest`, `dev`, `main`, `sha-*`, or pre-release tags
- **THEN** those tags are not offered as selectable specified versions

### Requirement: Identify the official release

The system SHALL resolve the manifest digest referenced by `latest` and SHALL identify the formal release tag with the same digest as the official release.

#### Scenario: Latest maps to a formal release

- **WHEN** `latest` and a formal `v1.x.y` tag reference the same manifest digest
- **THEN** the Admin marks that `v1.x.y` as the official release and labels it as `latest`

#### Scenario: Latest has no formal release alias

- **WHEN** no formal release tag has the same digest as `latest`
- **THEN** the official-release choice is unavailable, the Admin shows a warning, and no version is guessed automatically

### Requirement: Select an upgrade target

The Admin SHALL present mutually exclusive official-release and specified-version choices, with the official release selected by default when it is available.

#### Scenario: Official release is selected by default

- **WHEN** the upgrade page loads and an official release was resolved
- **THEN** the official-release choice is selected and displays its `v1.x.y` tag with a `latest` label

#### Scenario: Operator chooses a specified release

- **WHEN** the operator selects the specified-version choice and a listed `v1.x.y` tag
- **THEN** that tag becomes the upgrade target and the official-release choice is deselected

### Requirement: Reveal displayed versions incrementally

The Admin SHALL initially display at most 10 specified formal releases from the complete discovered formal-release set and SHALL allow the operator to reveal the next 10 when additional releases are available.

#### Scenario: Initial list is limited

- **WHEN** more than 10 formal releases are available
- **THEN** the specified-version list displays exactly the newest 10 and shows a `More` control

#### Scenario: More loads additional releases

- **WHEN** the operator activates `More`
- **THEN** the next 10 formal releases are appended without duplicating earlier entries

#### Scenario: No additional releases exist

- **WHEN** all formal releases have been displayed
- **THEN** the `More` control is hidden or disabled

### Requirement: Preserve official update detection

The system SHALL compare the installed image against the floating `latest` image when determining whether an official update is available, regardless of whether `AI_ENGKIT_VERSION` is pinned to a formal release.

#### Scenario: A pinned installation has a newer official release

- **WHEN** `AI_ENGKIT_VERSION` contains an older formal release and `latest` resolves to a different newer manifest
- **THEN** the system reports that an official update is available

#### Scenario: A pinned installation matches latest

- **WHEN** the installed pinned image has the same manifest or effective image digest as `latest`
- **THEN** the system reports that no official update is available

### Requirement: Preserve upgrade safety boundaries

The version discovery and upgrade endpoints SHALL remain protected by Admin authentication, SHALL preserve the existing upgrade-in-progress conflict response, and SHALL not initiate an upgrade when release discovery or target validation fails.

#### Scenario: Unauthenticated discovery is rejected

- **WHEN** a request without a valid Admin session accesses version discovery
- **THEN** the system rejects the request according to the existing Admin authentication behavior

#### Scenario: Registry discovery fails

- **WHEN** GHCR token, tag, or manifest discovery fails
- **THEN** the Admin exposes an actionable error, disables upgrade submission, and leaves the persisted environment unchanged

#### Scenario: Upgrade is already running

- **WHEN** an upgrade request arrives while another upgrade is running
- **THEN** the system returns the existing conflict response and does not change the selected target

#### Scenario: Dev build is running

- **WHEN** the running Admin image is identified as a dev build
- **THEN** the version selector and registry discovery are not offered, and the existing dev-build upgrade restriction remains visible

#### Scenario: No formal release is available

- **WHEN** discovery succeeds but returns no formal `v1.x.y` release
- **THEN** no version is selected, upgrade submission is disabled, and the Admin explains that no formal release is available

### Requirement: Validate and persist the selected target

The upgrade request SHALL accept only a resolved official release or a formal tag returned by the version discovery service, SHALL persist the selected tag in `AI_ENGKIT_VERSION`, and SHALL use that tag for the image pull and container recreation.

#### Scenario: Valid target starts upgrade

- **WHEN** the operator submits a listed formal release
- **THEN** the system persists that tag, starts the upgrade using the corresponding image reference, and reports upgrade progress normally

#### Scenario: Invalid target is rejected

- **WHEN** an upgrade request contains an unknown, malformed, or non-formal tag
- **THEN** the system rejects the request before changing the environment or starting the upgrade

#### Scenario: Official target is pinned reproducibly

- **WHEN** the operator submits the official-release choice
- **THEN** the system uses the resolved `v1.x.y` tag rather than the floating `latest` tag
