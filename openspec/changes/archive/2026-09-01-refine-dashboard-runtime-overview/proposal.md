## Why

The Admin Dashboard repeats the same LeanCTX metrics across multiple large panels while omitting concise visibility into the runtime configuration and AI execution dependencies that explain whether those metrics and model operations are trustworthy. A compact, status-first overview will make the page faster to scan without duplicating the dedicated configuration and management pages.

## What Changes

- Reorganize the Dashboard into distinct site status, LeanCTX KPI, runtime profile, project/container, AI runtime, and LeanCTX insight layers.
- Remove repeated LeanCTX memory/activity rows from the Projects card and remove repeated headline savings values from the detail area.
- Consolidate Token Savings detail, Decision Loop, Evidence Chain, and Savings by Tool into one compact LeanCTX Insights section.
- Add a read-only LeanCTX Runtime Profile showing effective compression, tool profile, derived security posture, archive retention, and saved-versus-effective apply state.
- Add Center connection state to the site summary using operator-facing `Connected`, `Standalone`, `Disconnected`, and `Unavailable` labels.
- Add a compact AI Runtime summary for provider readiness and SubAgent model effectiveness, with anomaly-first copy and links to the dedicated management pages.
- Place Container Status, Projects, and AI Runtime in one three-column operational row on desktop, stacking below 1025px for tablet and mobile readability.
- Make both Dashboard Projects surfaces link to `/projects`; make GitHub, GitLab, and Git status items link to `/auth/github`, `/auth/gitlab`, and `/git-config`; make the AI-EngKit version link to `/versions`.
- Keep AI Runtime labels readable within the desktop three-column cards by preventing label shrinkage and allowing long aggregate values to wrap safely.
- Define deterministic text, semantic tone, severity ordering, unavailable states, responsive layout, accessibility behavior, and click destinations for every new summary.
- Keep secrets, account identifiers, model-by-model detail, configuration controls, and provider key metadata out of the Dashboard.

## Capabilities

### New Capabilities
- `admin-dashboard-runtime-overview`: Defines the Dashboard information hierarchy, LeanCTX Runtime Profile, Center status, AI Runtime provider/SubAgent summaries, state derivation, semantic tones, links, responsive behavior, and safe data projection.

### Modified Capabilities
- `admin-dashboard-value-metrics`: Replaces separate full-width LeanCTX value panels with one compact Insights section and removes values already represented by the KPI summary.
- `leanctx-admin-config`: Preserves local editor dirty-state behavior while adding a conservative, read-only applied-snapshot contract for the Dashboard Runtime Profile.

## Impact

- Affects Dashboard data collection and rendering in `src/admin/server.ts`, `src/admin/views/dashboard.tsx`, and related styles and tests.
- The final Dashboard polish additionally affects only `src/admin/views/dashboard.tsx`, `src/admin/static/style.css`, and the corresponding design/test artifacts; it does not change Dashboard data collection.
- Reuses existing Center agent status, LeanCTX configuration/schema, provider metadata, live provider catalog, and Agent Model state collectors, projected into secret-free aggregate types.
- May require a new bounded effective-runtime LeanCTX status source so the Dashboard does not mislabel saved TOML values as active runtime values.
- Adds no new external dependency and does not change Center, Provider, Agent Model, or LeanCTX configuration mutation behavior.
