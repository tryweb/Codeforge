## Context

The Admin upgrade flow now has two distinct modes. An absent `AI_ENGKIT_VERSION` means the deployment follows the promoted `:latest` image and upstream `main` assets; a non-blank value pins the deployment to a formal release tag. The existing capability specification still describes every selected target as a persisted pin and does not describe the configured-versus-installed version state shown by the Admin page.

## Goals / Non-Goals

**Goals:**

- Make the API contract distinguish installed version from configured upgrade mode.
- Make the UI default and stale-pin behavior deterministic and safe.
- Document the explicit official/specified request contract and environment mutation.
- Align the main capability spec with the already implemented and tested behavior.

**Non-Goals:**

- Do not change the backup, health polling, reconciliation, or SSE pipeline.
- Do not change GHCR discovery, digest resolution, or update-check semantics.
- Do not change the Dashboard's separate upgrade badge behavior in this change; its omitted target type remains the specified/pinned compatibility path unless a future change explicitly adopts the Official channel.
- Do not execute a destructive container upgrade as part of browser verification.

## Decisions

### Treat the environment pin as the persisted mode

The route reads and trims `AI_ENGKIT_VERSION` for `configured_version`. Blank values are treated as absent because Compose and image resolution already interpret them as the `:latest` fallback. A separate mode field is unnecessary because the existing environment variable is the persistence contract.

### Keep installed and configured versions separate

`current_version` comes from the installed image's `VERSION` file, while `configured_version` comes from the Admin environment file. They can legitimately differ during an upgrade transition or when a pin is changed, so the UI displays the installed value and uses the configured value only for target preselection.

### Submit target type explicitly

The browser sends both the resolved formal version and `target_type`. The server revalidates both values against the discovery result obtained at submission time: Official must match the resolved `official_version`; Specified must be in the resolved formal release list. The existing short-lived discovery cache may apply, so this is not required to be an uncached GHCR request. This keeps the user-facing mode explicit while preserving server-side safety boundaries.

### Clear the pin for Official

The official path removes only `AI_ENGKIT_VERSION` through the existing environment helper before invoking the no-argument upgrade pipeline. The pipeline then resolves `:latest` and fetches upstream assets from `main`. The specified path preserves the existing read-modify-write behavior for the selected formal tag.

### Handle stale configured pins conservatively

If a configured tag is not in the discovered list, the page keeps Specified selected, explains the problem, and disables submission. The operator must select a currently discoverable version or Official when it is available; the server remains the final validator.

## Risks / Trade-offs

- **Latest drift** → The server resolves and validates the official version again on submission; a stale page fails safely instead of upgrading an unintended release.
- **Stale configured pin** → The UI blocks submission and requires an explicit valid replacement; no version is guessed.
- **Floating Official channel** → Clearing the pin means a subsequent upgrade follows the promoted `:latest` image and `main` assets rather than a reproducibly fixed tag; this is the intended distinction from Specified mode.
- **Separate Dashboard entry point** → The Dashboard may continue to pin because it uses the compatibility path without `target_type`; document this boundary until it is intentionally changed.

## Migration Plan

No data migration is required. Existing pins continue to select Specified mode. Existing unpinned installations select Official mode. Selecting Official intentionally removes the pin; selecting Specified intentionally writes the chosen formal release. Rollback is limited to reverting the follow-up implementation and leaving existing environment values unchanged.

## Open Questions

None.
