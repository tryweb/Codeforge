## Context

ai-admin is a Bun + Hono SSR JSX app (`src/admin/`): 12 views sharing one `Layout` component, one 169-line `style.css`, one global `app.js`. No frontend framework, no build step. Current mobile support is a viewport meta tag plus a single `@media (max-width: 768px)` block that turns the fixed 240px sidebar into a full-width block stacked above content — so every mobile page load starts with scrolling past ~12 nav links.

Verified driving workflows (user-confirmed, daily): create project (`projects.tsx` modal), view versions (`versions.tsx` cards), restart ai-dev (`env-editor.tsx`, endpoint `POST /api/env/restart`). All high-risk actions already guard with native `confirm()` dialogs, which work fine on mobile.

Constraints:
- SSR multi-page app: every navigation is a full page reload — no client-side state persists between pages (and none is needed)
- Must not change desktop rendering (current 768px breakpoint behavior is the baseline)
- `login.tsx` / `setup.tsx` do NOT use `Layout` — they are standalone pages with their own `<head>`; they share `style.css` only
- Known pre-existing quirk: `layout.tsx` loads `/static/app.js` twice (harmless, idempotent script) — out of scope, do not fix here

## Goals / Non-Goals

**Goals:**
- Mobile (≤768px) navigation via hamburger toggle: sidebar hidden by default, opens as an overlay, closes on backdrop tap or page navigation
- All interactive elements reach ≥44px effective touch target on narrow viewports
- Wide tables remain readable via horizontal scroll, without breaking page width
- Modals fit small viewports with safe margins
- Dashboard offers "Restart ai-dev" with confirmation and status feedback, reusing the existing restart endpoint
- Zero new dependencies; plain CSS + vanilla JS only

**Non-Goals:**
- Full responsive redesign of desktop-centric pages (env-editor form layout, ssh-keys, git-config, gh/glab-auth) — they inherit nav + touch-target improvements only
- Any change to OpenChamber (upstream package, not this repo)
- Backend/API changes (routes, auth, restart logic stay as-is)
- Fixing the duplicate `app.js` script tag or other unrelated cleanups

## Decisions

### D1: Hamburger = overlay sidebar, not push or top-row-scroll

Add a mobile-only top bar inside `Layout` (`.topbar` with `#nav-toggle` button + compact logo), rendered for all pages but hidden above 768px via CSS. On ≤768px the sidebar becomes `position: fixed; transform: translateX(-100%)`; a `nav-open` class on `.app-layout` slides it in and shows a `.nav-backdrop`.

- **Why overlay**: content never reflows horizontally; sidebar keeps its exact desktop markup/styles; pattern is ~15 lines of CSS
- **Why not push**: pushing `.main-content` requires animating margins on a full-width column — janky on low-end phones
- **Why not horizontal scrollable link row**: 12 nav items + separators is too long to scan; user explicitly chose hamburger
- **Why JS toggle (in `app.js`) over pure-CSS checkbox hack**: checkbox hack has poor accessibility (no focus management, label-based toggle) and pollutes markup; `app.js` is already global and vanilla — a ~10-line guarded listener (`if (!toggle) return`) is cleaner. Sidebar default state is hidden-with-CSS, so with JS disabled the toggle simply does nothing — acceptable degradation for an authed ops panel

State reset on navigation is a non-issue: SSR full reload naturally closes the nav, which is the desired behavior.

### D2: Touch targets via media-query overrides, no markup changes

Inside `@media (max-width: 768px)`: raise `button`, `.btn-outline`, and nav `<a>` to `min-height: 44px` with matching vertical padding; override the small in-table action buttons (`Enable`, dashboard `↻ Restart` which use inline `padding:2px 8px;font-size:0.7-0.75rem`) with `!important`-free class-targeted rules.

- Inline `style=` attributes beat stylesheet rules without `!important`. The few offending elements (table Enable buttons, dashboard restart) get targeted via attribute/class selectors with `!important` scoped to the media query — contained and explicit. Alternatives (editing every inline style out of views) touch more files for no behavioral gain
- 44px follows Apple HIG / WCAG 2.5.5 target size guidance

### D3: Table scroll = `.card { overflow-x: auto }` inside the media query

Tables live inside `.card` containers (dashboard, projects, versions). One rule in the media query makes any too-wide table horizontally scrollable without touching any view file.

- **Why not wrap every table in `.table-scroll` divs**: 3+ view files edited, new class to remember for future tables; the card-level rule covers current AND future tables automatically
- **Risk accepted**: `overflow-x: auto` on cards clips absolutely-positioned children — verified no tooltips/popovers/dropdowns render inside `.card` (modals are `.modal-overlay` siblings, not card children)

### D4: Modal fit via viewport-relative max-width

`.modal { max-width: min(480px, calc(100vw - 32px)); }` in the media query; `.modal-overlay` gains small padding. Existing `max-width:400px` inline style on the About modal is compatible (max() with the CSS rule resolves to the smaller constraint on phones).

### D5: Dashboard restart reuses `POST /api/env/restart` — no new endpoint

Add a "↻ Restart ai-dev" button to the dashboard (danger styling, next to container status / existing admin restart). JS mirrors `env-editor.tsx`: `confirm("Restart ai-dev container? ...")` → `POST /api/env/restart` → status text feedback (`Restarting...` → `Restarted ✔` / error).

- **Why reuse**: the endpoint already implements the dual-path restart logic (compose recreate in production, plain restart in dev/DooD) from `admin-env-editor-dataflow.md`; duplicating it under a second path adds a maintenance liability for zero behavioral difference
- **Trade-off accepted**: the `/api/env/...` path is semantically awkward for a dashboard button. Renaming the route would break the env editor and any external callers — not worth it for cosmetics
- The button calls the endpoint directly via fetch; the shared `confirm()` guard means accidental mobile taps require a second deliberate tap on a native dialog

### D6: Everything lives in the existing three frontend files

`layout.tsx` (top bar + backdrop markup), `style.css` (media query block extension), `app.js` (toggle listener), plus `dashboard.tsx` (restart button + handler). No view-by-view responsive edits; no new files except spec-mandated test additions.

## Risks / Trade-offs

- [Specificity battles with inline `style=` attributes on small buttons] → Contain `!important` to the two known selectors inside the media query only; visually verify dashboard/projects/versions pages at 375px width
- [Sidebar overlay z-index collides with `.modal-overlay`] → Define stacking order explicitly: backdrop < sidebar < modal-overlay; verify About modal still opens above everything
- [With JS disabled, mobile nav cannot open] → Accepted: admin is a JS-dependent authed panel (login, restart, SSE all require JS already)
- [`.card` overflow rule could double-scroll if a future card nests scrollable content] → Document the rule's intent in a CSS comment; revisit if a nested-scroll card appears
- [iOS Safari bottom bar obscuring fixed sidebar footer (Logout link)] → Sidebar uses `top:0;bottom:0` fixed positioning (not `100vh`), which tracks the visual viewport correctly on iOS

## Migration Plan

Pure frontend change to the admin sidecar. Deploy = rebuild image and recreate `ai-admin` (existing release pipeline). Rollback = redeploy previous image tag. No data, env, or API migrations.

## Open Questions

- Playwright MCP (bundled Chromium per `playwright-mcp-bundled-browser.md`) can emulate a 375px viewport for verification — use it for manual QA screenshots during implementation, but keep automated assertions in `test/test-admin-ui.sh` curl-based (consistency with existing suite)
