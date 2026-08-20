# lean-ctx `compression_level = "standard"` blinds the agent to diagnostic output

## Context
ai-engkit's Docker image bakes a lean-ctx config into
`/home/devuser/.config/lean-ctx/config.toml` (Dockerfile ~lines 143–156).
The agent executes shell commands via lean-ctx's `ctx_shell` and reads files via
`ctx_read`. lean-ctx wraps and compresses command output to save tokens.

## Problem
The original bake set `compression_level = "standard"`, which is **more aggressive
than lean-ctx's upstream default (`lite`)**. At this level, lean-ctx's triage
pipeline returns the placeholder

```
[lean-ctx: N lines filtered by triage (level 2)]
```

instead of the actual output, whenever the content matches its filter heuristic —
**including** the low-level diagnostics the agent needs to recover from edit
failures: `od -c`, `sed | cat -A`, `xxd`, binary inventories, multi-line help
text, shell transcripts, etc. The filter applies to **both** live shell output
and `ctx_read` of persisted files; narrow window reads and filename renames do
**not** bypass it (the decision is content-scored, not path/length-scoped).

Concrete failure mode (observed in an OpenChamber session titled
"AI-EngKit lean-ctx 過濾正交問題釐清"):

1. `Edit File` fails: `Could not find oldString in the file. It must match
   exactly, including whitespace, indentation, and line endings.`
2. Agent runs `sed -n '460,476p' file.tsx | od -c` to inspect the exact bytes.
3. The `od -c` output is triaged → `8 lines filtered by triage (level 2)`.
4. `ctx_read` of the same range also returns the filter placeholder.
5. Agent loops: can't edit (mismatch), can't diagnose (output hidden), can't edit.

## Solution
Change the baked `compression_level` from `"standard"` to `"lite"` (lean-ctx's
upstream default). `lite` restores visibility for routine diagnostics while
still compressing large routine output.

Canonical runtime change (no image rebuild needed):

```bash
docker exec -u devuser ai-engkit-dev bash -c \
  'lean-ctx config set compression_level lite && lean-ctx config apply'
```

Permanent image change (`Dockerfile` ~line 148):

```diff
- compression_level = "standard"
+ compression_level = "lite"
```

For the rare case where `lite` still filters content the agent needs, use the
per-command escape hatches (allowlist still applies):

```bash
LEAN_CTX_RAW=1 od -c file.tsx              # uncompressed this run
LEAN_CTX_DISABLED=1 sed -n '460,476p' …    # bypass compression + shell hook
lean-ctx raw "od -c file.tsx"              # CLI form
```

## Why It Works
- `compression_level` enum is `off | lite | standard | max`; upstream default
  is `lite`. `standard`/`max` enable the aggressive triage that hides
  diagnostic content.
- `LEAN_CTX_RAW=1` and `lean-ctx --raw` skip compression for one invocation.
- `LEAN_CTX_DISABLED=1` additionally disables the shell hook for that invocation.
- The BASH_ENV-loaded hook (`/home/devuser/.config/lean-ctx/env.sh`) re-reads
  `config.toml` on every non-interactive bash invocation, so config edits take
  effect immediately for new shell calls — no daemon restart required for the
  shell path (daemon restart via `config apply` handles the long-running parts).

## Side Effects / Tradeoffs
- `lite` is **less aggressive than `standard`, not zero**: it still triages
  some content (score-based). For guaranteed raw output, use the escape
  hatches above or `compression_level = "off"`.
- `off` defeats lean-ctx's token-savings purpose for routine commands; use
  only when actively debugging.
- Raising `compression_level` to `standard`/`max` to "see more" makes the blind
  spot **worse**, not better.

## Evidence
- OpenChamber session screenshot showing the `Edit File` → `od -c` filtered →
  `ctx_read` filtered loop (the trigger for this fix).
- Reproduced empirically: wrote a 6-line transcript file → under `standard`,
  every `ctx_read` window returned `[lean-ctx: 117 lines filtered by triage
  (level 2)]`; after applying `lite`, the same file read through cleanly.
- `lean-ctx config apply` output:
  `Updated compression_level = lite` followed by
  `[1/4] Validating config… [2/4] Restarting processes… [3/4] Running safety checks… [4/4] Config applied successfully.`

## Related Files
- `Dockerfile` (~line 148, `compression_level` in baked `config.toml`)
- `.opencode/AGENTS.md.default` (added `### When lean-ctx Triage Hides Diagnostic Output` section)
- `/home/devuser/.config/lean-ctx/config.toml` (runtime, in container)
- `/home/devuser/.config/lean-ctx/env.sh` (BASH_ENV-loaded hook)
- `docs/knowledge/tooling/lean-ctx-optimization.md` (companion: allowlist tuning)

## Tags
lean-ctx, compression, triage, ctx_shell, ctx_read, diagnostic-output,
debuggability, blind-spot