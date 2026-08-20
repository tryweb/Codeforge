# lean-ctx permanently blocks `bash -c` / `sh -c`; use script files or `ctx_execute`

## Context
The agent runs shell commands via lean-ctx's `ctx_shell` (or `lean-ctx -c`).
lean-ctx enforces defense-in-depth command gating per its `SECURITY.md`:
executable allowlist, blocking of `eval`/`exec`/`source`, **interpreter
inline-code blocking (`bash -c`)**, file-write detection, and dangerous-flag /
environment-hijack detection.

## Problem
Interpreter inline-code execution is permanently blocked. Calling
`bash -c '…'` or `sh -c '…'` returns:

```
[BLOCKED — DO NOT RETRY] Interpreter 'bash' with inline code execution flag '-c' is blocked. Use a script file instead.
This is a permanent security restriction.
```

This breaks workflows that wrap multi-step logic in `bash -c`, including
diagnostic wrappers like `bash -c 'od -c file | head'` that the agent reaches
for when an edit fails.

The block is **independent of `shell_allowlist_extra`**: adding `bash` (or `sh`)
via `lean-ctx allow bash` does **not** unblock `bash -c` (verified empirically
— the same "permanent security restriction" message is returned). The global
`shell_security = "warn"` / `"off"` modes do lift it, but weaken the gate
globally for every command.

## Solution
Per lean-ctx's own error message: **write the script to a file and execute
the file** (any of these pass; no `-c` flag):

```bash
# 1) Write to a file (heredoc, or your Write/editor tool)
cat > /tmp/run.sh <<'EOF'
echo "step 1"
docker ps
EOF

# 2) Execute the file
bash /tmp/run.sh                      # ✅ allowed
sh  /tmp/run.sh                      # ✅ allowed
chmod +x /tmp/run.sh && /tmp/run.sh  # ✅ allowed
```

For non-trivial conditional / cross-language logic, prefer the `ctx_execute`
MCP tool (sandboxed code execution supporting 11 languages) over shell
scripting.

Single direct commands (`git status`, `docker ps`, `jq …`) run normally — only
explicit `bash -c` / `sh -c` wrapper forms are blocked.

## Why It Works
- lean-ctx's gate inspects the **top-level interpreter invocation flag**;
  `bash /path` resolves to "execute file", not "inline code", and is therefore
  permitted.
- The BASH_ENV-loaded shell hook (`env.sh`) propagates into nested bash
  invocations that have BASH_ENV set, so inner commands in a script are still
  subject to the per-command allowlist and compression.
- `ctx_execute` runs in a separate sandbox outside the shell-hook path.

## Side Effects / Tradeoffs
- Requires the agent to write a file before running it (extra step vs inline
  `bash -c`).
- `./script.sh` after `chmod +x` works because the shebang routes through the
  allowlisted interpreter path; no separate allowlist entry needed.
- Setting `shell_security = "warn"` / `"off"` to lift the block globally is
  **not recommended** — it disables the gate for every command, not just
  `bash -c`.

## Evidence
- Direct `ctx_shell` reproduction of the block message (verbatim above).
- Verified: `bash /path/script.sh`, `sh /path/script.sh`, `./path/script.sh`
  (after `chmod +x`) all run and execute their content.
- Verified: `lean-ctx allow bash` followed by `bash -c '…'` is **still
  blocked** with the same permanent-restriction message — adding to the
  allowlist is provably ineffective.
- lean-ctx upstream docs (`SECURITY.md`,
  `docs/reference/13-security-and-governance.md`,
  `docs/reference/02-daily-use.md`) confirm: interpreter `-c` block is a
  hardcoded rule in `shell_security = "enforce"` (default), independent of
  the executable allowlist.

## Related Files
- `.opencode/AGENTS.md.default` (added `### Executing Shell Commands &
  Dynamically-Generated Scripts` section)
- `/home/devuser/.config/lean-ctx/config.toml` (`shell_security = "enforce"`
  is the default; do not change to `warn`/`off` to "fix" the `bash -c` block)

## Tags
lean-ctx, shell-security, bash-c, sh-c, interpreter, ctx_execute, script-file,
allowlist, defense-in-depth