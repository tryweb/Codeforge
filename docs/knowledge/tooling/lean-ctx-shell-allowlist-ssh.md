# lean-ctx shell allowlist blocks SSH commands by default

## Context
The container installs `openssh-client` (Dockerfile line 51) and configures `~/.ssh` directory (lines 310-312) for SSH key management. However, lean-ctx's shell security feature blocks SSH commands (`ssh`, `ssh-keygen`, `scp`, `sftp`, `ssh-add`) unless they are explicitly added to `shell_allowlist_extra`.

## Problem
Running SSH commands through lean-ctx (via `ctx_shell` or `lean-ctx -c`) returns:

```
[BLOCKED — DO NOT RETRY] 'ssh' is not in the shell allowlist. This is a permanent restriction, not a transient error.
Fix (additive, keeps the defaults): run  lean-ctx allow ssh
Config in effect: /home/devuser/.config/lean-ctx/config.toml
```

This blocks all SSH operations including remote connections, key generation, and file transfers.

**Note**: This is different from the `bash -c` block (which is a hardcoded security rule). SSH commands can be unblocked via the allowlist.

## Solution
Add SSH commands to `shell_allowlist_extra` in the lean-ctx config:

**Option 1: Runtime fix (per container)**
```bash
lean-ctx allow ssh ssh-keygen scp sftp ssh-add
```

**Option 2: Permanent fix (Dockerfile)**
```toml
# In ~/.config/lean-ctx/config.toml
shell_allowlist_extra = ["gh", "glab", "docker", "docker-compose", "docker compose", "pw-mcp", "bun", "marksman", "codegraph", "openspec", "ssh", "ssh-keygen", "scp", "sftp", "ssh-add"]
```

## Why It Works
- lean-ctx's shell security enforces an executable allowlist for commands run through its shell hook
- `shell_allowlist_extra` is additive — it extends the built-in list without replacing it
- Adding to this array makes commands available immediately (no daemon restart required)
- This is consistent with the container already installing OpenSSH and configuring SSH directories

## Side Effects / Tradeoffs
- **None** — SSH is already installed and the `~/.ssh` directory is already configured
- The allowlist is additive, so existing allowed commands are not affected
- This follows the same pattern as other tools already in the list (`gh`, `glab`, `docker`, etc.)

## Evidence
- Before fix: `lean-ctx -c 'ssh -V'` → `[BLOCKED — DO NOT RETRY] 'ssh' is not in the shell allowlist`
- After fix: `lean-ctx -c 'ssh -V'` → `OpenSSH_9.6p1 Ubuntu-3ubuntu13.18, OpenSSL 3.0.13 30 Jan 2024`
- `lean-ctx allow --list` shows SSH commands in the extra allowlist after running `lean-ctx allow ssh`

## Related Files
- `Dockerfile` (line 150) — `shell_allowlist_extra` configuration
- `~/.config/lean-ctx/config.toml` — runtime configuration
- `docs/knowledge/tooling/lean-ctx-bash-c-permanent-block.md` — related but different issue (`bash -c` block is hardcoded, not configurable)

## Tags
lean-ctx, shell-security, allowlist, ssh, ssh-keygen, scp, sftp, openssh, configuration, dockerfile
