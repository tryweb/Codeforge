# Mobile Drawer 100vh Pitfall (100dvh Fix)

## Context

The Admin Dashboard sidebar is a fixed off-canvas drawer on mobile
(`src/admin/static/style.css`: `.sidebar` in the ≤768px media query and the
`.mobile` mirror block). A bottom utility row (`.nav-icons`: About + Logout)
is pinned with `margin-top: auto`.

## Problem

With `height: 100vh`, mobile Chrome/Brave compute the drawer box against the
**large viewport** (space behind the URL bar / bottom toolbar). Bottom-anchored
content (`margin-top: auto`) lands below the visible fold and is cut off —
the drawer looks like it just ends with empty space. Headless emulation does
NOT reproduce this (no browser chrome, so 100vh == visible height), which
made the bug invisible in Playwright screenshots while real Pixel 9 devices
(Chrome and Brave) both showed it.

## Solution

- `height: 100vh; height: 100dvh;` on all three `.sidebar` rules (base,
  media query, `.mobile` mirror). The duplicate-property linter warning is
  intentional progressive enhancement: old browsers use `100vh`, modern ones
  override with `100dvh` (dynamic = visible viewport height).
- Belt-and-braces: `.nav-icons { position: sticky; bottom: 0; ... }` so the
  row stays visible even when the drawer scrolls (short landscape screens).
- Do NOT "fix" the duplicate `height` lines — removing the `100vh` fallback
  breaks old browsers; removing `100dvh` reintroduces the cut-off.

## Why It Works

`100dvh` tracks the actually-visible viewport height, so the drawer's bottom
edge (and the auto-margined icon row) always sits inside the visible area
regardless of URL-bar / toolbar state.

## Side Effects / Tradeoffs

- Related earlier misdiagnosis: exotic emoji glyphs (U+1F6C8, U+23FB) were
  first blamed; replaced with inline SVG anyway (still the right call for
  font independence).

## Evidence

- 2026-09: Pixel 9 Chrome + Brave both cut the icon row; emulation showed it
  fine. After `100dvh` + sticky fix, deployed to dev admin (:8081) for device
  retest.

## Related Files

- `src/admin/static/style.css` (`.sidebar` × 3, `.nav-icons`)
- `src/admin/views/layout.tsx` (`.nav-icons` markup)

## Tags

admin, css, mobile, viewport, drawer
