## 1. Upgrade API Contract

- [x] 1.1 Verify `GET /api/upgrade/versions` exposes `current_version` and trimmed `configured_version` for unpinned, pinned, blank, dev-build, and discovery-error responses; add or update route tests until all cases pass
- [x] 1.2 Verify `POST /api/upgrade` accepts only `official` and `specified` target types, rejects stale or invalid targets before side effects, and preserves the existing authentication and concurrency boundaries
- [x] 1.3 Verify an Official request removes only `AI_ENGKIT_VERSION` before starting the existing upgrade pipeline, while a Specified request persists the selected formal tag; cover environment preservation and failure paths with route tests

## 2. Upgrade UI Behavior

- [x] 2.1 Verify the upgrade page displays the installed `current_version` for production and dev-build responses without exposing the selector in a dev build
- [x] 2.2 Verify an unpinned response preselects Official and a pinned response preselects Specified with the configured version selected in the dropdown
- [x] 2.3 Verify a configured version missing from the discovered list remains selected as Specified, shows an actionable warning, disables submission, and allows an explicit valid replacement
- [x] 2.4 Verify the browser submits `target_type: official` or `target_type: specified` according to the selected radio while preserving progress and SSE behavior

## 3. Integration Verification

- [x] 3.1 Run route and view tests plus the related GHCR, image-reference, environment, and server tests; expect no failures caused by this change
- [x] 3.2 Build and start the dev environment with `docker-compose.dev.yml`, then use Playwright with a non-destructive production-like `VERSION` override to verify unpinned and pinned selector states; restore the dev state after testing
- [x] 3.3 Verify the Dashboard upgrade badge remains explicitly documented as the existing specified/pinned compatibility path and does not unintentionally change its behavior

## 4. Specification Synchronization

- [x] 4.1 Synchronize the approved delta into `openspec/specs/admin-upgrade-version-selection/spec.md` and verify the main spec describes both Official/latest and Specified/pinned modes
- [x] 4.2 Run `openspec validate align-admin-upgrade-channel-semantics --strict --no-interactive` and verify all change artifacts are valid and ready for archive
