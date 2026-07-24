## Context

The ai-admin dashboard's typography is defined in `src/admin/static/style.css`. The previous phase aligned font-family stacks with OpenChamber (`--font-sans`, `--font-mono`). The remaining gap is font sizing: admin uses a `14px` base with hardcoded rem values, while OpenChamber uses a `16px` base with a Tailwind CSS token system.

The admin dashboard already uses CSS custom properties for color tokens (`--bg`, `--surface`, `--text`, `--accent`, etc.) and the newly added `--font-sans` / `--font-mono`, making it natural to extend the same pattern to font-size tokens.

## Goals / Non-Goals

**Goals:**
- Admin HTML base font-size changes from `14px` to `16px`, matching OpenChamber and browser default
- Introduce `--text-*` CSS custom property tokens mirroring OpenChamber's Tailwind token scale
- All hardcoded `font-size` values in `style.css` replaced with `var(--text-*)` references

**Non-Goals:**
- No change to layout, spacing, or component structure
- No change to inline `font-size` in `.tsx` view templates (those are intentional per-component overrides, not typography scale)
- No change to OpenChamber's CSS

## Decisions

### Font Size Token Mapping

| Admin Usage | Current (14px base) | OpenChamber Token | New Value (16px base) | New Token |
|---|---|---|---|---|
| html base | `14px` | — | `16px` | — |
| body default | `.875rem → 12.25px` | `--text-base: 1rem → 16px` | `1rem → 16px` | `--text-base` |
| labels | `.8125rem → 11.4px` | `--text-ui-label: .875rem → 14px` | `.875rem → 14px` | `--text-ui-label` |
| table headers | `.8125rem → 11.4px` | `--text-sm: .875rem → 14px` | `.875rem → 14px` | `--text-sm` |
| `.text-sm` | `.8125rem → 11.4px` | `--text-sm: .875rem → 14px` | `.875rem → 14px` | `--text-sm` |
| code / mono | `.8125rem → 11.4px` | `--text-code: .8125rem → 13px` | `.8125rem → 13px` | `--text-code` |
| buttons / inputs | `.875rem → 12.25px` | `--text-ui-label: .875rem → 14px` | `.875rem → 14px` | `--text-ui-label` |
| `.card h3` | `1rem → 14px` | `--text-lg: 1.125rem → 18px` | `1.125rem → 18px` | `--text-lg` |
| sidebar h1 | `1rem → 14px` | `--text-lg: 1.125rem → 18px` | `1.125rem → 18px` | `--text-lg` |
| sidebar subtitle | `.75rem → 10.5px` | `--text-xs: .75rem → 12px` | `.75rem → 12px` | `--text-xs` |
| sidebar nav a | `.875rem → 12.25px` | `--text-sm: .875rem → 14px` | `.875rem → 14px` | `--text-sm` |
| badges | `.75rem → 10.5px` | `--text-xs: .75rem → 12px` | `.75rem → 12px` | `--text-xs` |
| auth-card h1 | `1.5rem → 21px` | `--text-3xl: 1.875rem → 30px` | `1.875rem → 30px` | `--text-3xl` |
| dashboard stat | `2rem → 28px` | `--text-4xl: 2.25rem → 36px` | `2.25rem → 36px` | `--text-4xl` |

### Token Variable Definitions Added

```css
:root {
  --text-xs:     .75rem;
  --text-sm:     .875rem;
  --text-base:   1rem;
  --text-lg:     1.125rem;
  --text-xl:     1.25rem;
  --text-2xl:    1.5rem;
  --text-3xl:    1.875rem;
  --text-4xl:    2.25rem;
  --text-code:   .8125rem;
}
```

Token names follow the same semantic scale as OpenChamber's Tailwind config. `--text-4xl` is added specifically for the dashboard's prominent stat number (project count, uptime).

### Rationale

- **Base 14px → 16px**: Eliminates the cognitive overhead of a non-standard base. 16px is the browser default, matching OpenChamber and most modern UI frameworks. All `rem` values now have identical meaning across both UIs.
- **`.card h3` 1rem→1.125rem**: Section headings need visual hierarchy. OpenChamber uses `--text-lg` for section headers; matching this keeps the admin dashboard feeling like part of the same product.
- **Dashboard stat 2rem→2.25rem**: The stat number is a hero element (project count, uptime). 2.25rem (36px) provides enough prominence at 16px base. Mapped to `--text-4xl` for future flexibility.

## Risks / Trade-offs

- **Layout regressions from 14px→16px base**: Changing the base font-size scales all rem values proportionally. Elements with fixed pixel dimensions or max-widths may look different. Most admin layout is flex/grid-based and should adapt. Risk: low.
- **Stat number size 28px→36px**: The dashboard project count stat gets significantly larger. This is intentional — it's a hero metric. If it looks too large, we can dial it to `--text-3xl` (30px) instead. Risk: cosmetic, easy to adjust.
- **Sidebar height increase**: With larger text, sidebar nav items will be taller. The sidebar `height: 100vh` is unaffected, but the nav item count may fill differently. The current 8 nav items + logout fit comfortably; no overflow expected. Risk: low.
- **Table density**: Larger table header text (11.4px→14px) increases table row height slightly. The dashboard tables have ample padding. Risk: low.
