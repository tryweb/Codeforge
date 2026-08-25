# lean-ctx shell layer silently dropping command execution and redirected writes

## Context

During the v1.15.7 staging verification + issue #61 fix session (2026-08-25),
`ctx_shell` began returning `[lean-ctx: N lines filtered by triage (level 2)]`
placeholders for commands whose entire purpose was to write output files.
Ground-truth checks proved those commands never executed against the real
filesystem — while identical patterns had worked minutes earlier in the same
session, with no config change in between.

## Problem

Two failure shapes observed back-to-back:

- Braced redirect block via `ctx_shell`:
  `{ GIT_MASTER=1 git checkout -b … && … ; } > /tmp/git1.txt 2>&1` returned a
  triage placeholder. Afterwards `/tmp/git1.txt` did not exist, and
  `git branch` / `git log` / `git ls-remote` showed no branch, no commits, no
  remote ref — the checkout/commit/push never ran.
- Script execution via `ctx_shell`: `bash /tmp/gitcheck.sh` (script internally
  did `{…} > /tmp/git2.txt`) returned `[lean-ctx: 6 lines filtered…]`;
  `/tmp/git2.txt` was never created.
- `ls -la /tmp/git1.txt /tmp/git2.txt` → `No such file or directory` for both,
  while files created by the `write` tool under `/tmp` persisted normally.

The tool reports success-shaped output, so trusting it means assuming commits
and pushes happened that never did.

Contrast: earlier in the same session, single-pipeline redirects such as
`bun test src/admin > /tmp/probe15.txt 2>&1` created their targets correctly,
and a braced block (`{ …; } > /tmp/git0.txt 2>&1`) also worked. Read-only
commands (`ls`, `cat`, `find`) kept working throughout.

## Solution

Route state-mutating or output-writing commands through `interactive_bash`
(tmux) instead of `ctx_shell`, and land outputs inside the project tree:

```bash
# one-time
tmux new-session -d -s gwork -c /home/devuser/workspace/ai-engkit
# per operation
tmux send-keys -t gwork 'mkdir -p .gitscratch && { git …; } > .gitscratch/stepN.txt 2>&1' Enter
```

Read results with `ctx_read` (project-local path); when triage replaces the
content, read the same file with `look_at`. Delete `.gitscratch/` before any
commit.

## Why It Works

- `interactive_bash` drives a real tmux pane outside the lean-ctx shell gate:
  no interception, no sandbox, real filesystem effects.
- Project-local scratch paths stay under the repo root so `ctx_read` can reach
  them (`ctx_read` refuses `/tmp`), and `look_at` reads the bytes directly
  without triage.
- Verifying side effects (`ls` the expected output file, then
  `git status --short --branch` / `git log` / `git ls-remote`) distinguishes
  "output filtered" from "never executed" — the decisive check.

## Side Effects / Tradeoffs

- `.gitscratch/` is untracked noise: remove it before committing.
- tmux sessions outlive their commands: reuse or kill them when done.
- Triage may still replace even project-local `ctx_read` results (observed);
  fall back to `look_at`.
- Internal root cause within lean-ctx is unknown (onset without config
  change). Treat ANY triage placeholder on a write-capable command as unproven
  until checked against the real filesystem.
- `LEAN_CTX_RAW=1` / `LEAN_CTX_DISABLED=1` hatches did not help here,
  consistent with the caveat in
  `troubleshooting/lean-ctx-triage-blinds-diagnostic-output.md`.

## Evidence

- Session 2026-08-25: probes 12–17 (`cmd > /tmp/probeN.txt 2>&1`) worked;
  the `git0` braced block worked; immediately afterwards the `git1` block and
  `bash /tmp/gitcheck.sh` produced placeholder-only responses with zero
  filesystem effects (`ls`: both targets missing; branch absent).
- Re-running the same operations via tmux produced commits `374f794` and
  `e251ff4`, pushed branch `fix/issue-61-nvidia-model-id`, and opened
  tryweb/ai-engkit#62 — confirming the original attempts never executed.

## Related Files

- `docs/knowledge/troubleshooting/lean-ctx-triage-blinds-diagnostic-output.md`
  — output visibility loss (commands DO run there; here they may not run at all)
- `docs/knowledge/tooling/lean-ctx-bash-c-permanent-block.md` — adjacent
  shell-gating restriction
- `docs/knowledge/tooling/host-script-alpine-compatibility.md` — script-file
  execution convention used by the workaround

## Tags

lean-ctx, ctx_shell, triage, silent-failure, tmux, interactive_bash, git, verification
