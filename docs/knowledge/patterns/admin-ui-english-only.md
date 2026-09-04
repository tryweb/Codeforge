# Admin UI English-Only Policy

## Context

The Admin Dashboard (`src/admin/`) is server-rendered Hono JSX with no i18n
framework, no locale files, and no language switcher. A 2026-09 menu-label
experiment briefly introduced Traditional Chinese group labels, which clashed
with the all-English sidebar and was reverted.

## Problem

Mixed-language UI strings look inconsistent (e.g. `text-transform: uppercase`
also mangles CJK labels), and adding non-English strings without an i18n
mechanism creates unmaintainable one-off translations.

## Solution

Present the Admin UI in **English only** until a proper multi-language
mechanism (locale files + language selection) is designed and approved.
Do not add non-English user-facing strings to `src/admin/` — labels, titles,
buttons, or nav items.

## Why It Works

- Single-language UI stays consistent with zero infrastructure cost.
- The rule is checkable in review: any non-English string in `src/admin/`
  views or static assets is a reject signal.

## Side Effects / Tradeoffs

- Non-English-speaking admins get English UI for now; accepted until i18n
  is formally scoped.

## Evidence

- 2026-09: Chinese sidebar group labels (`Git 託管` / `Git 設定` / `系統`)
  reverted per user feedback; goal restated as menu slimming, not labeling.

## Related Files

- `src/admin/views/layout.tsx` (NAV_ITEMS)
- `src/admin/static/style.css`

## Tags

admin, ui, i18n, convention
