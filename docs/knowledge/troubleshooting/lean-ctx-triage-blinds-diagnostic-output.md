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
and `ctx_read` of persisted files. Re-measured 2026-08-24 under a *healthy*
`lite`: whole-file reads are still suppressed wholesale, while narrow
`lines:N-M` windows (roughly ≤ 6 lines / a few hundred chars) pass — the
decision is score-and-size based, not path-based.

**Config-vs-daemon drift reproduces the same blindness.** The triage tier is
fixed when the lean-ctx daemon starts; editing `compression_level` in
`config.toml` alone changes nothing for the running daemon. On 2026-08-24 the
disk said `lite` while every tool result still reported
`[lean-ctx: N lines filtered by triage (level 2)]` — until
`lean-ctx config apply` restarted the daemon.

Concrete failure mode (observed in an OpenChamber session titled
"AI-EngKit lean-ctx 過濾正交問題釐清"):

1. `Edit File` fails: `Could not find oldString in the file. It must match
   exactly, including whitespace, indentation, and line endings.`
2. Agent runs `sed -n '460,476p' file.tsx | od -c` to inspect the exact bytes.
3. The `od -c` output is triaged → `8 lines filtered by triage (level 2)`.
4. `ctx_read` of the same range also returns the filter placeholder.
5. Agent loops: can't edit (mismatch), can't diagnose (output hidden), can't edit.

## Solution
The current repository baseline is explicit `compression_level = "off"`. The
2026-08-25 reliability gate classified the fleet as `disable-routing`, so
automatic Read, Search, and Shell routing remains disabled. CodeGraph and
native tools are authoritative; lean-ctx remains available for memory,
knowledge, and non-authoritative opt-in exploration. Escape hatches are not a
reliable correctness boundary under daemon or configuration drift.

The following 2026-08-24 runtime command is retained only as historical
reproduction evidence for the intermediate `lite` mitigation. It is not the
current repository policy, and Apply remains an explicit administrator action:

```bash
docker exec -u devuser ai-engkit-dev bash -c \
  'lean-ctx config set compression_level lite && lean-ctx config apply'
```

`apply` restarts ONLY the lean-ctx daemon, and both halves matter (observed
2026-08-24):

1. The daemon does **not** hot-reload config. Skipping `apply` leaves the old
   triage tier running even though `config.toml` already shows the new value —
   `config set` even answers `already set to lite — unchanged` while filtering
   continues at the old level.
2. After the daemon swap, every `ctx_*` MCP tool in **running sessions** hangs
   with `MCP error -32001: Request timed out` (the long-lived `opencode serve`
   hosts lean-ctx MCP children bound to the dead daemon). Recovery requires
   restarting OpenChamber / `opencode serve` — brand-new dispatched sessions
   stay broken too until then.

Historical intermediate image change (`Dockerfile` ~line 148); the current
baseline uses `off` instead:

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
- The shell-path hatches (`LEAN_CTX_RAW=1`, `LEAN_CTX_DISABLED=1`) are honored
  only while the daemon and `config.toml` agree. Measured 2026-08-24: with a
  stale daemon they silently did nothing on the MCP tool path; after the daemon
  was restarted onto the on-disk `lite` config, both hatches passed full output
  through `ctx_shell`. Treat them as unreliable whenever results show `(level
  2)` notices — fix the daemon first (`config apply` + OpenChamber restart).

## Side Effects / Tradeoffs
- `lite` is **less aggressive than `standard`, not zero** — measured 2026-08-24
  under a freshly applied `lite`: whole-file `ctx_read` still returns the
  level-2 placeholder (sometimes substituted with unrelated context snippets,
  e.g. the repo `AGENTS.md` head), and plain `stat` / `od -c` / `head -20`
  output via `ctx_shell` is still suppressed. What works reliably: commands
  prefixed with `LEAN_CTX_RAW=1` or `LEAN_CTX_DISABLED=1`, and narrow
  `lines:N-M` windows (small outputs only; `lines:1-41` of a 41-line file was
  filtered). For correctness-sensitive raw output, use native tools; the
  hatches are only best-effort when daemon and configuration health is known.
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

### 2026-08-24 re-verification (container restart → fresh daemon on `lite`)

- 41-line marker fixture: default / `full` / `raw`+`fresh` / `aggressiveness=0`
  / `protect` `ctx_read` → 41/41 lines filtered; `lines:5-10` → clean;
  `lines:1-41` → filtered (size-gated, not mode-gated).
- Plain `ctx_shell` `stat` / `od -c` / `head -20` → filtered; same commands
  prefixed with `LEAN_CTX_RAW=1` or `LEAN_CTX_DISABLED=1` → full output.
- `lean-ctx config set compression_level lite` → `already set to lite —
  unchanged`; `lean-ctx config apply` → `daemon stopped (PID …)` + new PID,
  while every `ctx_*` tool returned `-32001` until OpenChamber restarted.

## Related Files
- `Dockerfile` (~line 148, `compression_level` in baked `config.toml`)
- `.opencode/AGENTS.md.default` (added `### When lean-ctx Triage Hides Diagnostic Output` section)
- `/home/devuser/.config/lean-ctx/config.toml` (runtime, in container)
- `/home/devuser/.config/lean-ctx/env.sh` (BASH_ENV-loaded hook)
- `docs/knowledge/tooling/lean-ctx-optimization.md` (companion: allowlist tuning)
- `opencode serve` process + OpenChamber PushWatcher (reconnects via ephemeral-port rediscovery after daemon or container restarts)

## Tags
lean-ctx, compression, triage, ctx_shell, ctx_read, diagnostic-output,
debuggability, blind-spot
