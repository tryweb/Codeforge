## Why

The user regularly runs OpenCode tasks from a phone via OpenChamber (port 8000) and needs the ai-admin dashboard (port 8080) as a companion panel in the same mobile session — to create projects, check component versions, and restart the ai-dev container. Today the admin UI is technically loadable on a phone (viewport meta + one 768px media query) but practically painful: the sidebar stacks full-width on top of every page (forcing a scroll past 8+ nav links before reaching content), buttons and table actions are below comfortable touch-target size, and wide tables/modals overflow narrow screens.

Mobile is a verified daily workflow, not an edge case — the admin UI should be usable end-to-end on a phone for the three core workflows without investing in full responsive redesign of desktop-centric pages (env editor, SSH keys, git config).

## What Changes

- **Collapsible mobile navigation**: at viewport ≤768px, the fixed 240px sidebar is replaced by a top bar with a hamburger toggle that opens/closes the nav (overlay or slide-down); desktop layout unchanged
- **Touch-target sizing**: interactive elements (buttons, nav links, in-table action buttons) reach ≥44px effective height on narrow viewports
- **Horizontally scrollable tables**: wide tables (projects overview, versions) get a scroll container so rows remain readable without breaking page layout
- **Mobile-fitting modals**: create-project and sync modals constrain width to viewport with safe padding
- **Dashboard "Restart ai-dev" shortcut**: the dashboard gains a restart-ai-dev action (same endpoint and confirmation flow as the env editor) so the most common mobile recovery operation does not require navigating to the env editor page

Out of scope: responsive redesign of env-editor, ssh-keys, git-config, gh/glab-auth pages beyond the shared navigation and global touch-target improvements; any change to OpenChamber (upstream package).

## Capabilities

### New Capabilities

- `admin-mobile-ui`: Mobile-adaptive layout for the ai-admin dashboard — collapsible hamburger navigation at narrow viewports, minimum touch-target sizing, horizontally scrollable tables, and viewport-fitting modals, applied globally via the shared layout and stylesheet
- `dashboard-container-restart`: Restart the ai-dev container directly from the dashboard page, with confirmation and status feedback, reusing the existing restart API

### Modified Capabilities

*(None — no main specs exist yet under `openspec/specs/`; prior admin capabilities live only in archived changes.)*

## Impact

- **`src/admin/views/layout.tsx`**: hamburger toggle button + top bar markup for narrow viewports; no change to desktop rendering
- **`src/admin/static/style.css`**: new/extended `@media (max-width: 768px)` rules (nav collapse, touch targets, table scroll wrappers, modal width); desktop rules untouched
- **`src/admin/static/app.js`**: small nav-toggle handler (and restart-ai-dev wiring if not page-local)
- **`src/admin/views/dashboard.tsx`**: "Restart ai-dev" button + confirmation + status feedback, calling existing `POST /api/env/restart` (or a shared restart endpoint)
- **No backend/API changes** expected: restart logic, auth, and all routes remain as-is
- **No new dependencies**: plain CSS + vanilla JS, consistent with current SSR JSX architecture (no framework, no build step)
- **Tests**: extend `test/test-admin-ui.sh` with mobile-viewport assertions where feasible (e.g., presence of nav toggle, media-query rules)
