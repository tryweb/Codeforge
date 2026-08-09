# src/admin Has No Typecheck Gate — Type Errors Ship Silently

## Context

The admin dashboard (`src/admin/`) is TypeScript + Hono + Bun, but its verification pipeline is **transpile-only**:

- `src/admin/package.json` has a single script: `"test": "bun test"` — no `typecheck`, no `tsc` step.
- `bun test` transpiles and runs; it does **not** type-check.
- `src/admin/tsconfig.json` only carries JSX settings (`jsx`, `jsxImportSource`) — no `strict`, no `noEmit` build step, no `include`.
- The TypeScript LSP was **not installed** in the dev environment (install declined), so interactive diagnostics also don't run.
- No CI gate runs `tsc` over `src/admin` either.

## Problem

Type errors — wrong property names, missing required fields, mismatched shapes — pass tests, pass the build, and reach the browser. Nothing in the normal loop reports them.

Concrete incident: the projects **overview** route type declared `disabled: boolean` on each project entry, but the object literal building the entries **omitted `disabled`**. Tests (46 pass) never noticed, the smoke render served fine, and the omission only surfaced during a careful source-level review (codegraph diff of the routes). A client rendering the toggle state would have silently shown every project as enabled.

## Solution

Treat type-correctness in `src/admin` as a manual verification step until a gate exists:

- When touching routes/views/lib, read the changed code once with types in view — verify each returned object literal actually satisfies the declared return type (field-by-field, not "looks right").
- Add a one-off typecheck when unsure: `cd src/admin && bunx tsc --noEmit -p tsconfig.json` (requires `typescript` + bun types installed; not part of the current pipeline).
- For tests that assert data shapes (e.g. overview entries), assert the **presence** of new boolean flags (`"disabled" in entry`) so a future omission fails loudly.

## Why It Works

Manual field-by-field review catches exactly what the transpile-only loop misses: declared-vs-assigned mismatch. Asserting flag presence in shape assertions turns the omission into a test failure the moment someone adds a new flag to the type but forgets the literal — the gap the incident exposed.

## Side Effects / Tradeoffs

- Manual review is fallible; the durable fix is a `typecheck` script + CI step over `src/admin` (out of scope for the incident).
- `bunx tsc` against this minimal tsconfig may flag missing type declarations for Bun/Hono APIs if `@types/bun` / `hono` aren't resolvable from `src/admin` — the config is not currently strict-ready.
- Adding `"disabled" in entry` assertions only guards flags you remember to assert; it is a belt-and-suspenders habit, not a complete solution.

## Evidence

- 46/46 admin tests pass while the overview literal omitted the typed `disabled` field — proving the suite does not type-check.
- The omission was found by reading the routes file with the declared type in view (codegraph), not by any tool failure.

## Related Files

- `src/admin/routes/projects.ts` — overview route whose literal omitted `disabled`
- `src/admin/package.json` — `"test": "bun test"` only, no typecheck script
- `src/admin/tsconfig.json` — JSX-only compilerOptions, no strict/build gate

## Tags

`typescript` `typecheck` `tsc` `bun` `admin` `pipeline-gap` `code-review`
