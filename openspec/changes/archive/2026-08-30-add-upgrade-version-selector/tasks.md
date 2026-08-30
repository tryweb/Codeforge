## 1. GHCR Release Discovery

- [x] 1.1 Add a server-side GHCR OCI client for bearer-token acquisition and paginated `tags/list` retrieval, and verify it handles successful responses, pagination links, and registry failures in unit tests
- [x] 1.2 Add formal `v1.x.y` filtering and numeric semantic-version sorting, and verify non-release/pre-release tags, duplicates, and numeric ordering are covered by unit tests
- [x] 1.3 Add `latest` manifest digest resolution with an explicit identical multi-media-type `Accept` header and descending early-exit candidate comparison, and verify matching, missing-alias, multiple-alias, and manifest-error cases in unit tests
- [x] 1.4 Add short-lived cached normalized release data and verify repeated discovery requests reuse the cache and expiry triggers refresh

## 2. Upgrade API

- [x] 2.1 Add the version discovery endpoint returning the complete formal-release set, official-version metadata, current version, and warnings, and verify response shape, Admin authentication, dev-build behavior, and registry failure handling with route tests
- [x] 2.2 Extend the upgrade endpoint to accept a formal selected version, re-resolve the official target when needed, and reject malformed, unknown, or unavailable targets before changing `.env`; verify all branches with route tests
- [x] 2.3 Persist a validated target through `AI_ENGKIT_VERSION` before calling the existing no-argument `runUpgrade()`, and verify the image reference resolves to the selected tag without changing backup, health, or SSE behavior
- [x] 2.4 Update the update-check path to compare the literal `ghcr.io/tryweb/ai-engkit:latest` reference even when `AI_ENGKIT_VERSION` is pinned, and verify pinned older/current installations report update availability correctly
- [x] 2.5 Preserve the existing upgrade-in-progress conflict response and verify a concurrent request returns `409` without changing `.env` or starting another upgrade

## 3. Admin Upgrade UI

- [x] 3.1 Replace the single upgrade action with mutually exclusive official-release and specified-version controls, defaulting to the resolved official release and showing its `latest` label; verify rendered controls and default state with view tests
- [x] 3.2 Implement specified-version rendering for the newest 10 formal releases and reveal the next 10 locally through `More`, hiding or disabling `More` when exhausted; verify duplicate-free expansion and loading/error states in browser tests
- [x] 3.3 Submit the selected target to the upgrade API, preserve the existing progress/SSE behavior, and show unavailable/no-target states for registry failure, missing `latest` alias, and an empty formal-release set; verify the full interaction with Admin E2E coverage
- [x] 3.4 Update the Dashboard's existing upgrade badge entry point to resolve and submit the official release target, and verify it no longer sends an invalid empty upgrade request

## 4. Regression Verification

- [x] 4.1 Run the Admin unit and route test suite and verify all existing upgrade, image-reference, environment, and server tests remain passing
- [x] 4.2 Run the Admin E2E upgrade-page test without starting a destructive upgrade and verify the selector, status API, and history API are available
- [x] 4.3 Run formatting/type diagnostics and the repository validation command, and verify the change artifacts and implementation introduce no type or lint errors
