## Why

The Admin upgrade implementation now distinguishes the floating Official release channel from a pinned Specified version, but the capability specification still describes the previous behavior where every selected release is persisted. Aligning the contract with the shipped behavior will make the upgrade mode, displayed state, and environment persistence rules unambiguous.

## What Changes

- Define `AI_ENGKIT_VERSION` as the persisted upgrade mode: absent or blank means Official/latest; a formal tag means Specified/pinned.
- Expose the installed `current_version` and configured `configured_version` in the version discovery response and display the installed version in the Admin upgrade page.
- Preselect Official when no version pin exists, or Specified with the configured tag when a pin exists.
- Add explicit `target_type` validation to upgrade requests.
- Clear `AI_ENGKIT_VERSION` when Official is submitted so the upgrade uses the floating `:latest` image and `main` upstream assets.
- Persist `AI_ENGKIT_VERSION` when Specified is submitted, preserving formal release validation and upgrade safety checks.
- Document and test stale configured pins without silently selecting a different release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec/specs/admin-upgrade-version-selection`: Align target selection, version visibility, and persistence requirements with the Official/latest and Specified/pinned upgrade modes.

## Impact

- Admin upgrade API: `GET /api/upgrade/versions` and `POST /api/upgrade`.
- Admin upgrade view and browser-side target selection state.
- Environment persistence through `AI_ENGKIT_VERSION`.
- Route, view, and Playwright verification for pinned, unpinned, stale-pin, and dev-build states.
- No changes to the backup, health polling, reconciliation, or SSE upgrade pipeline.
