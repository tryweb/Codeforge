## 1. Canonical Baseline and Startup Migration

- [x] 1.1 Move the Dockerfile LeanCTX defaults to `/etc/lean-ctx/config.default.toml` and verify the built image contains the complete baseline, including `shell_allowlist_extra`
- [x] 1.2 Update `entrypoint.d/02-init-config.sh` to seed `/home/devuser/.config/lean-ctx/config.toml` only when absent and verify an existing user value survives container restart
- [x] 1.3 Add missing-key migration and malformed-TOML backup/error handling, then verify existing keys are preserved and malformed content is never silently treated as `{}`
- [x] 1.4 Update `docker-compose.dev.yml` volume/runtime wiring and verify image rebuild plus container recreate preserves the runtime configuration volume

## 2. Admin Configuration Contract
- [x] 2.1 Replace Raw TOML and per-field immediate-save controls with pending form edits and an explicit Save Changes action
- [x] 2.2 Update Apply labels, status messages, and result copy to state that applying restarts the LeanCTX daemon in ai-dev
- [x] 2.3 Add browser coverage proving Save enables Apply and unsaved edits cannot be applied

- [x] 2.1 Replace duplicated operational defaults in `src/admin/lib/leanctx-schema.ts` with baseline loading or an equivalent canonical-default adapter and verify schema presentation matches the Dockerfile baseline
- [x] 2.2 Update `src/admin/lib/leanctx.ts` to distinguish baseline, runtime, and project configuration sources and verify effective configuration and source metadata are correct
- [x] 2.3 Update `src/admin/routes/leanctx.ts` so save, per-key reset, full reset, validation, and malformed-config errors use the canonical baseline and verify API contract tests
- [x] 2.4 Update `src/admin/views/leanctx-editor.tsx` to display effective values/defaults and actionable parse errors, then verify the editor has no console errors

## 3. Automated Coverage

- [x] 3.1 Add unit tests for baseline loading, missing-key migration, reset behavior, validation, and malformed TOML handling; verify with `cd src/admin && bun test`
- [x] 3.2 Add integration tests for runtime file persistence across restart/recreate and verify user values are not overwritten by image defaults
- [x] 3.3 Add Playwright coverage for first-load defaults, edit/save, reload persistence, Reset to Defaults, and malformed-config recovery; verify the final runtime configuration is restored to baseline

## 4. Image and Release Verification

- [x] 4.1 Build the dev image with `docker compose -f docker-compose.dev.yml build ai-dev` and verify the packaged baseline file and Admin bundle are present
- [x] 4.2 Recreate `ai-admin` and `ai-dev`, run the complete test suite, and verify the Admin UI and LeanCTX runtime use the expected effective values
- [x] 4.3 Run `openspec validate --change canonical-leanctx-admin-config --strict` and verify all proposal, spec, design, and task artifacts are valid
