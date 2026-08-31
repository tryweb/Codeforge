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

### Requirement: Expose installed and configured versions

The Admin version-discovery response SHALL expose both the installed image version and the configured upgrade version. `current_version` SHALL identify the installed image version, while `configured_version` SHALL contain the trimmed `AI_ENGKIT_VERSION` value or `null` when the variable is absent or blank.

#### Scenario: Unpinned installation reports no configured version

- **WHEN** `AI_ENGKIT_VERSION` is absent, empty, or contains only whitespace
- **THEN** the response returns the installed `current_version` and `configured_version: null`

#### Scenario: Pinned installation reports both versions

- **WHEN** `AI_ENGKIT_VERSION` contains a formal release tag
- **THEN** the response returns the installed `current_version` and the trimmed configured tag in `configured_version`

### Requirement: Select an upgrade target

The Admin SHALL present mutually exclusive official-release and specified-version choices. When an official release is available, the default choice SHALL depend on the configured upgrade mode: Official SHALL be selected when `configured_version` is `null`, and Specified SHALL be selected when `configured_version` is non-null. A configured version that is present in the discovered formal-release list SHALL be selected in the specified-version control.

#### Scenario: Official release is selected by default

- **WHEN** the upgrade page loads with `configured_version: null` and an official release was resolved
- **THEN** the official-release choice is selected and displays its `v1.x.y` tag with a `latest` label

#### Scenario: Pinned installation defaults to specified release

- **WHEN** the upgrade page loads with a configured formal version that is present in the discovered release list
- **THEN** the specified-version choice is selected and the configured tag is selected in the version control

#### Scenario: Operator chooses a specified release

- **WHEN** the operator selects the specified-version choice and a listed `v1.x.y` tag
- **THEN** that tag becomes the upgrade target and the official-release choice is deselected

#### Scenario: Configured version is not discoverable

- **WHEN** the upgrade page loads with a configured version that is absent from the discovered formal-release list
- **THEN** the specified-version choice remains selected, an actionable warning is shown, and upgrade submission is disabled until the operator chooses a valid target

#### Scenario: Official release is unavailable

- **WHEN** no formal release tag shares the manifest digest of `latest`
- **THEN** the official-release choice is disabled, a warning is shown, and no target is selected automatically unless a valid configured version is available

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

The upgrade request SHALL accept an explicit target type of `official` or `specified`. It SHALL validate the submitted version against the resolved official release for an official target, or against the discovered formal release set for a specified target. An official target SHALL remove `AI_ENGKIT_VERSION` before starting the upgrade so the image resolves through the floating `:latest` channel. A specified target SHALL persist its formal tag in `AI_ENGKIT_VERSION` before starting the upgrade.

#### Scenario: Official target clears the version pin

- **WHEN** the operator submits the resolved official version with `target_type: official`
- **THEN** the system removes `AI_ENGKIT_VERSION`, starts the upgrade using `:latest`, and preserves all unrelated environment variables

#### Scenario: Specified target persists a formal release

- **WHEN** the operator submits a discovered formal release with `target_type: specified`
- **THEN** the system persists that tag in `AI_ENGKIT_VERSION` and starts the upgrade using the corresponding image reference

#### Scenario: Omitted target type uses specified compatibility behavior

- **WHEN** an upgrade request omits `target_type` and submits a discovered formal release
- **THEN** the system treats the request as a specified target, persists that tag in `AI_ENGKIT_VERSION`, and starts the upgrade

#### Scenario: Valid target starts upgrade

- **WHEN** the operator submits a valid official or specified target
- **THEN** the system applies the target mode, starts the upgrade, and reports upgrade progress normally

#### Scenario: Official target does not match the resolved release

- **WHEN** an official request submits a version different from the server-resolved `official_version`
- **THEN** the system returns a client error without modifying the environment or starting an upgrade

#### Scenario: Invalid target is rejected

- **WHEN** an upgrade request contains an unknown, malformed, or unavailable target
- **THEN** the system rejects the request before changing the environment or starting the upgrade

#### Scenario: Invalid target type is rejected

- **WHEN** an upgrade request contains a target type other than `official` or `specified`
- **THEN** the system returns a client error without modifying the environment or starting an upgrade

#### Scenario: Discovery or target validation fails

- **WHEN** release discovery fails or the submitted target is unavailable or malformed
- **THEN** the system leaves the persisted environment unchanged and does not start an upgrade

#### Scenario: Official target uses the floating channel

- **WHEN** the operator submits the official-release choice
- **THEN** the system clears `AI_ENGKIT_VERSION` and uses the resolved official release through the floating `latest` channel rather than persisting a version pin
