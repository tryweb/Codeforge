## 1. Font Family (already done)

- [x] 1.1 Add `--font-sans` and `--font-mono` CSS custom properties to `:root` block in `style.css`
- [x] 1.2 Update `body` `font-family` to use `var(--font-sans)` with OpenChamber-aligned stack
- [x] 1.3 Update `code, .code, .device-code, .log-viewer, .masked-value` to use `var(--font-mono)`

## 2. Font Size Token System

- [x] 2.1 Change `html { font-size: 14px }` to `16px`
- [x] 2.2 Add `--text-*` CSS custom properties (`--text-xs` through `--text-4xl`, `--text-code`) to `:root`
- [x] 2.3 Replace `body` font-size with `var(--text-sm)` (per user feedback — one step down from `--text-base` for dashboard density)
- [x] 2.4 Replace label font-size with `var(--text-sm)`
- [x] 2.5 Replace table header (`th`), `.text-sm`, sidebar nav links font-size with `var(--text-sm)`
- [x] 2.6 Replace `code`, `.code`, `.log-viewer` font-size with `var(--text-code)`
- [x] 2.7 Replace button, input font-size with `var(--text-sm)`
- [x] 2.8 Replace `.card h3`, `.sidebar .logo h1` font-size with `var(--text-lg)`
- [x] 2.9 Replace `.sidebar .logo .subtitle`, `.badge` font-size with `var(--text-xs)`
- [x] 2.A Replace `.auth-card h1` font-size with `var(--text-3xl)`
- [x] 2.B Replace dashboard stat numbers font-size with `var(--text-4xl)`

## 3. Verification

- [x] 3.1 Check all hardcoded `font-size` values removed from `style.css` (verified — 0 hardcoded rem/px values remain, only `html { font-size: 16px }` base)
- [x] 3.2 Verify admin pages render correctly at 16px base (verified via container build + test)
