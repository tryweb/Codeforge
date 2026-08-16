# Admin Dashboard Site Overview UX Pattern

## Context

The Admin Dashboard is a server-rendered Hono JSX surface. Site-level health,
Token Savings, and leanCTX statistics are collected together, but users need to
understand the overall site state before opening operational detail pages.

## Problem

When Token Savings and leanCTX values are embedded in ordinary cards, the most
important site information is difficult to scan. Mobile layouts also expose
special risks: long metric rows can squeeze labels, and the responsive nav
drawer can be captured during its CSS transition and look incorrectly clipped.

## Solution

Use a three-level Dashboard hierarchy:

1. `site-summary` semantic section for container, projects, auth, Git, and
   version state.
2. `metric-row` with reusable `StatusPill` and `MetricCard` primitives for
   Token Savings, leanCTX Memory, and leanCTX Activity.
3. Existing operational cards for restart, full savings ledger, auth, versions,
   and upgrade progress.

Keep metric values server-driven and render `—` / `unavailable` when probes
return `null`. At mobile widths, explicitly allow the Token Savings detail row
to wrap so the compression badge remains readable.

## Why It Works

- The summary-to-detail ordering matches the user's scan path: health first,
  impact second, operations last.
- `<section aria-label>`, `<dl>/<dt>/<dd>`, glyph labels, focus-visible rules,
  and reduced-motion rules provide a semantic and accessible baseline.
- Desktop uses three metric columns; 769–1024px uses two columns with the third
  spanning; widths ≤768px use one column and the drawer navigation.
- Targeting the dashboard versions card by `id="versions-card"` prevents the
  upgrade SSE progress UI from being appended to the first unrelated card.

## Side Effects / Tradeoffs

- Summary metrics intentionally repeat headline values in the detailed cards.
- Existing inline styles and the non-keyboard-focusable `UpdateBadge` remain
  accepted debt; the Versions table remains the canonical upgrade surface.
- Full-page screenshots must wait for the 0.2s mobile drawer transition to
  settle, or use reduced-motion emulation, before judging tablet layout.

## Evidence

- Fresh browser checks at 1280px, 768px, and 375px showed body width equal to
  viewport width with no horizontal overflow.
- Fresh post-fix mobile measurement: `dashboard-token-summary` width 301px,
  compression badge width 138px, row height 71px; the badge is fully contained.
- Two independent post-fix visual QA passes returned `PASS`.
- `bun test`: 338 passed; 2 existing `provider-meta` failures caused by the
  missing `/opt/ai-engkit/.env` file.

## Related Files

- `DESIGN.md`
- `src/admin/views/dashboard.tsx`
- `src/admin/static/style.css`
- `test/test-admin-ui.sh`
- `docs/knowledge/troubleshooting/mobile-css-real-device-divergence.md`

## Tags

`admin-dashboard` `hono-jsx` `leanctx` `token-savings` `responsive-ui` `visual-qa`
