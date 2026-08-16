# DESIGN.md — AI-EngKit Admin Dashboard

Design contract for the admin dashboard. Server-rendered Hono JSX (no client
framework); styling lives in `src/admin/static/style.css` as plain CSS classes.

## 1. Design contract

- Dark zinc theme: background `#18181b`, surface `#27272a`, border `#3f3f46`.
- Text `#f4f4f5`, muted `#a1a1aa`; green accent `#10b981` (hover `#34d399`).
- Semantic colors: success `#10b981`, danger `#ef4444`, warning `#f59e0b`.
- Radius `8px`; 4px spacing grid (8 / 12 / 16 / 20 / 24).
- Typography: Inter (sans) for UI, JetBrains Mono (mono) for code/versions.
- Layout: fixed 240px sidebar + `.main-content` (max-width 1200px); topbar
  drawer replaces the sidebar at ≤768px.

## 2. Tokens

All tokens are CSS custom properties on `:root` in `style.css`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#18181b` | page background |
| `--surface` | `#27272a` | cards, sidebar, inputs |
| `--border` | `#3f3f46` | borders, dividers |
| `--text` | `#f4f4f5` | primary text |
| `--text-muted` | `#a1a1aa` | secondary text, labels |
| `--accent` / `--accent-hover` | `#10b981` / `#34d399` | primary actions, focus, active nav |
| `--danger` | `#ef4444` | errors, destructive actions, stopped state |
| `--success` | `#10b981` | healthy state |
| `--warning` | `#f59e0b` | degraded state, update available |
| `--radius` | `8px` | card/input radius |
| `--font-sans` / `--font-mono` | Inter / JetBrains Mono | UI / code |
| `--text-xs` … `--text-4xl` | 0.75rem … 2.25rem | type scale |
| `--text-code` | 0.8125rem | inline code |

## 3. Primitives

Named classes, defined in `style.css`; JSX primitives live in
`src/admin/views/dashboard.tsx`.

### StatusPill — `.status-pill` + `.status-pill--{tone}`
Compact rounded status indicator. Tones: `success`, `danger`, `warning`,
`neutral`. Used for container status, auth state, version mismatch. Accepts an
optional `ariaLabel` for glyph-only labels (e.g. `✓` / `✗`).

### MetricCard — `.metric-card` (+ `.metric-card--accent`)
Overview metric surface. Rendered as `<dl>` with `<dt>` title, `<dd>` value,
optional `<dd>` sub and foot (foot separated by a top border). Accent tone adds
a green-tinted gradient border for the headline metric. Value uses
`font-variant-numeric: tabular-nums` for stable scanning.

### SiteSummary band — `.site-summary` + `__item` / `__label` / `__value`
Compact status strip directly under the page heading. Flex-wrap row of
label/value pairs and pills: container status + uptime, project count, GitHub /
GitLab auth, git user, admin version mismatch, update availability.

### Existing primitives (unchanged contract)
- `.card` — surface container with 20px padding, 16px bottom margin.
- `.badge` + `.badge-success` / `.badge-danger` / `.badge-warning` — small
  rounded status labels (detail views).
- `.btn` / `.btn-outline` / `.btn-danger` — actions; 44px min-height on mobile.
- `table` — bordered detail rows (auth, versions).
- `.progress-bar` / `.fill` — upgrade progress.
- `.log-viewer` / `.log-entry` — upgrade event log.

## 4. Dashboard page structure

Order is fixed: heading → site summary band → overview metric row →
operational cards.

1. `h2` page heading.
2. `.site-summary` band — scannable site status.
3. `.metric-row` — three `.metric-card`s: **Token Savings** (net tokens saved,
   net USD saved, compression %), **leanCTX Memory** (total memory facts,
   projects with facts, health coverage), **leanCTX Activity** (active projects
   in 24h, savings ledger integrity).
4. Operational cards: Container Status (restart + admin mismatch), Projects
   (count + leanCTX detail rows), Token Savings (full ledger: gross, overhead,
   net, SHA-256 chain), Auth Status, Component Versions (update badge + upgrade
   progress).

The overview row is the summary layer; the cards below keep the full detail.
Null probes render `—` / "unavailable" in the overview and keep the layout
stable.

## 5. Responsive rules

| Breakpoint | Behavior |
|---|---|
| ≥1025px | 3-column `.metric-row`; sidebar visible |
| 769–1024px | `.metric-row` 2 columns, third card spans full width |
| ≤768px (and `.mobile` class) | `.metric-row` 1 column; sidebar → topbar drawer; `.grid-2`/`.grid-3` stack; 44px touch targets; cards scroll horizontally |
| 320px floor | `.site-summary` wraps; metric values fit at `--text-3xl` |

## 6. Accessibility constraints

- `:focus-visible` outline: 2px `--accent`, 2px offset, on links, buttons,
  inputs, and tabbable elements.
- Semantic structure: `<section aria-label>` for the metric row, `<dl>/<dt>/<dd>`
  for metric cards, `aria-label` on the site summary band and on glyph-only
  pills.
- `prefers-reduced-motion`: all transitions/animations collapse to ~0 duration.
- Touch targets ≥44px on mobile (buttons, nav links).
- Muted text (`#a1a1aa`) on surface (`#27272a`) keeps ≥4.5:1 contrast.

## 7. Accepted debt

- Pre-existing inline `style=` attributes across views; migrate to named
  classes incrementally (this change adds classes for new primitives only).
- Emoji glyphs as icons in nav/buttons (pre-existing).
- `UpdateBadge` is a `<span>` with `onclick` (not keyboard-focusable) —
  pre-existing; the Component Versions table remains the canonical upgrade
  trigger.
- Per-view inline `<script>` blocks (no client framework); the dashboard
  upgrade/restart script stays in `dashboard.tsx` (SIZE_OK — splitting it into
  `app.js` is out of scope).
- Metric values formatted with `toLocaleString()` server-side (server locale).
- Overview row and detail cards intentionally repeat headline numbers
  (summary/detail pattern).