## Why

The Admin upgrade action currently upgrades only the configured image reference, leaving operators without a safe way to choose or inspect a specific official release. This change makes release selection explicit while preserving a convenient official-release path that follows the image published as `latest`.

## What Changes

- Add mutually exclusive Admin upgrade choices for the resolved official release and a specified `v1.x.y` release.
- Obtain published image tags through the GHCR OCI Distribution API.
- Resolve which semantic version currently points to `latest` by comparing manifest digests.
- Show the newest 10 formal `v1.x.y` releases initially, with a `More` interaction for additional releases.
- Persist the selected release through `AI_ENGKIT_VERSION` before starting the upgrade.
- Validate selected tags and handle a `latest` image with no matching formal release without silently guessing.
- Preserve update detection against the floating `latest` reference even after an explicit version has been pinned.

## Capabilities

### New Capabilities

- `admin-upgrade-version-selection`: Discover formal GHCR releases, identify the release represented by `latest`, and select the image version used by Admin upgrades.

### Modified Capabilities

<!-- No existing capability specs are present; the current upgrade behavior is covered by the new capability. -->

## Impact

- Admin upgrade view and browser interaction in `src/admin/views/upgrade.tsx`.
- Upgrade routes and GHCR OCI integration in `src/admin/routes/upgrade.ts` and supporting Admin libraries.
- Existing image-reference and environment persistence behavior using `AI_ENGKIT_VERSION`.
- Unit, route, and Admin E2E tests for release discovery, digest resolution, pagination, validation, and upgrade submission.
