## Why

The ai-admin dashboard and OpenChamber Web UI are companion interfaces that users switch between in the same browser — OpenChamber for daily AI coding, ai-admin for configuration and system management. Currently, the two use different sans-serif font stacks (admin uses `Roboto`, OpenChamber uses `SF Pro Text / system-ui`), causing a visual disjointedness when toggling between them. Aligning the typography makes the two surfaces feel like parts of the same product rather than bolt-on pieces.

## What Changes

- **Modified `src/admin/static/style.css`**: update `body` `font-family` to match OpenChamber's sans-serif stack (`system-ui, -apple-system, ...`) instead of the current `-apple-system, ..., Roboto, ...`
- **Introduce CSS custom properties** for fonts (`--font-sans`, `--font-mono`) following the existing pattern (`--bg`, `--surface`, `--text`, etc.) already used for colors
- **Full font-size alignment**: change `html` base from `14px` to `16px` (matching OpenChamber / browser default), and introduce `--text-*` token system (e.g., `--text-sm`, `--text-base`, `--text-lg`, `--text-code`) mirroring OpenChamber's Tailwind token scale
- **Replace all hardcoded `font-size`** values in `style.css` with `var(--text-*)` references

## Capabilities

### New Capabilities

*(None — this is a visual refinement of the existing admin dashboard, not a new feature.)*

### Modified Capabilities

*(None — no spec-level behavior changes, purely a styling change.)*

## Impact

- **`src/admin/static/style.css`**: ~6 lines changed/added (font-family on `body`, new `--font-sans` and `--font-mono` CSS vars)
- **All admin view templates** (`*.tsx`): unaffected — they inherit from `style.css`
- **Visual**: admin dashboard sans-serif becomes identical to OpenChamber's on every OS
