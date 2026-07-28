## 1. Mobile Navigation (hamburger)

- [x] 1.1 Add mobile top bar markup to `src/admin/views/layout.tsx`: `.topbar` containing `#nav-toggle` hamburger button and compact logo, placed before `.sidebar`; add `.nav-backdrop` element inside `.app-layout`
- [x] 1.2 Extend `@media (max-width: 768px)` block in `src/admin/static/style.css`: hide default sidebar (`position:fixed; transform:translateX(-100%); transition`), show `.topbar`, style `.nav-open` state (sidebar visible + backdrop visible), set z-index order backdrop < sidebar < modal-overlay
- [x] 1.3 Add guarded toggle listener to `src/admin/static/app.js`: `#nav-toggle` click toggles `nav-open` on `.app-layout`; `.nav-backdrop` click removes it; no-op when elements absent (login/setup pages)
- [x] 1.4 Verify at 375px and 768px widths: sidebar hidden by default, opens on toggle, closes on backdrop tap, closes after following a nav link; verify >768px desktop layout pixel-unchanged

## 2. Touch Targets & Layout Polish

- [x] 2.1 In the media query, add `min-height:44px` + matching padding for `button`, `.btn-outline`, and `.sidebar nav a`
- [x] 2.2 Enlarge small inline-styled action buttons (projects table "Enable", dashboard restart) to ≥44px effective height via class-targeted rules with `!important` scoped to the media query
- [x] 2.3 Add `.card { overflow-x: auto; }` inside the media query
- [x] 2.4 Add modal fit rules: `.modal { max-width: min(480px, calc(100vw - 32px)); }` inside the media query
- [x] 2.5 Verify at 375px: projects table scrolls horizontally without page-level horizontal scroll; create-project modal fully visible with margins; all buttons comfortably tappable

## 3. Dashboard Restart ai-dev Shortcut

- [x] 3.1 Add "↻ Restart ai-dev" button (danger styling) to `src/admin/views/dashboard.tsx` near the container status / existing admin restart button
- [x] 3.2 Implement `restartAiDev()` handler in dashboard: `confirm()` guard → `POST /api/env/restart` → status text transitions (`Restarting...` → `Restarted ✔` / error), button state restored on failure
- [x] 3.3 Verify: no request fires when confirm is cancelled; success and failure feedback paths both render; behavior matches env editor restart

## 4. Tests & Verification

- [x] 4.1 Extend `test/test-admin-ui.sh`: assert `layout` HTML contains `nav-toggle` and `nav-backdrop`; assert `style.css` media query contains nav/touch/table/modal rules; assert dashboard HTML contains the restart-ai-dev button
- [x] 4.2 Run `test/test-admin-ui.sh` against the dev admin container — all assertions pass (20/20)
- [x] 4.3 Manual QA via Playwright MCP at 375px viewport on dashboard, projects, versions, env pages: capture screenshots, confirm all spec scenarios for `admin-mobile-ui` and `dashboard-container-restart`
