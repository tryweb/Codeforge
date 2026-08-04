# SSH Key Auto-Registration with ssh-agent

## Context

ai-engkit admin dashboard provides SSH key management (generate, list, view
public key, deploy). The `ssh-keygen` command runs in the `ai-dev` container
via `execInAiDev()`. Keys are stored in `/home/devuser/.ssh/` on a named volume.

The Deploy button copies a one-liner command that installs the public key on a
remote host's `~/.ssh/authorized_keys`. For passwordless SSH to work, the local
SSH client must present the corresponding private key.

## Problem

Before the fix, generated SSH keys were not registered with `ssh-agent`:

1. User generates a key via Admin dashboard → key pair created on disk
2. User clicks Deploy → copies Linux/Windows command, runs it on remote host
3. User runs `ssh user@remote` → still asked for password

Root causes:
- `ssh-agent` was not started at container boot (no `SSH_AUTH_SOCK` anywhere)
- Generate Key did not run `ssh-add`, so the private key was never loaded
- `~/.bashrc` had no source for the agent environment, so new shells couldn't
  discover the agent
- `docker exec` (used by `execInAiDev`) does not source `~/.bashrc`, so API
  handlers also couldn't access the agent

## Solution

Three-layer fix:

### 1. Persistent ssh-agent at container boot

`entrypoint.d/04-init-git-ssh.sh` starts `ssh-agent` as `devuser` if not
already running, saving env vars to `~/.ssh/agent.env`:

```bash
sudo -u devuser ssh-agent -s > ~/.ssh/agent.env
chmod 600 ~/.ssh/agent.env
```

The idempotency check uses the socket file existence (not `ssh-add -l` exit
code, which would false-positive on an empty agent):

```bash
if [ ! -f "$AGENT_ENV" ] || ! ( . "$AGENT_ENV" && [ -S "$SSH_AUTH_SOCK" ] ); then
  sudo -u devuser ssh-agent -s > "$AGENT_ENV"
fi
```

### 2. Shell inheritance via .bashrc + .bashenv

Both `~/.bashrc` (interactive shells) and `~/.bashenv` (lean-ctx non-interactive
shells) get a snippet to source `agent.env`:

```bash
# SSH agent
if [ -f "$HOME/.ssh/agent.env" ]; then
  source "$HOME/.ssh/agent.env"
fi
```

### 3. Auto ssh-add on Generate Key

`src/admin/routes/ssh-keys.ts` POST handler runs `ssh-add` immediately after
key generation:

```typescript
await execInAiDev(
  `. ~/.ssh/agent.env 2>/dev/null && ssh-add ~/.ssh/${name} 2>/dev/null || true`,
  5_000
);
```

The explicit `. ~/.ssh/agent.env` is required because `execInAiDev` uses
`docker exec` which doesn't source any shell rc files.

## Why It Works

- `ssh-agent` is a persistent per-container daemon — survives shell restarts
- `agent.env` file contains `SSH_AUTH_SOCK` and `SSH_AGENT_PID`; sourcing them
  is all SSH needs to find the agent
- Container startup scans the SSH volume and reloads existing private keys that
  have an empty passphrase. Fingerprints prevent duplicate registrations.
- `ssh-add` registers the private key; SSH client automatically tries all agent
  keys during authentication, matching against the remote's `authorized_keys`
- The explicit source in the API handler ensures the `docker exec` context also
  finds the agent

## Side Effects / Tradeoffs

- **Agent persistence**: Container restart re-evaluates the entrypoint check,
  starts a fresh agent when needed, and reloads existing unencrypted keys from
  the SSH volume. The key files survive as long as the named volume survives.
- **Passphrase-protected keys**: Startup never prompts or attempts a passphrase;
  those keys are skipped and require an explicit interactive `ssh-add`.
- **Volume dependency**: `agent.env` and key files live on the `ssh-keys-dev`
  Docker volume. `docker compose down -v` removes them, so keys must be
  recreated or restored afterward.
- **Passphrase-protected existing keys**: Keys that cannot be loaded without a
  passphrase remain outside the agent and require manual `ssh-add`.
- **No `ssh-add` for Deploy-only**: The Deploy button copies the command but
  doesn't call `ssh-add`. If the user deploys a key that isn't in the agent,
  SSH still asks for a password. The key must be either newly generated (auto
  ssh-add) or manually added.

## Evidence

- Agent starts at boot, survives shell restarts
- `Generate Key` → `ssh-add -l` shows the new key immediately
- `ssh -o BatchMode=yes root@<remote>` returns `OK` (passwordless) when the
  corresponding public key is deployed
- Verified with `jonathan-02` key: generated → agent shows it → deployed to
  172.16.1.21 → SSH works without password

## Related Files

- `entrypoint.d/04-init-git-ssh.sh` — ssh-agent startup + .bashrc/.bashenv injection
- `src/admin/routes/ssh-keys.ts` — POST handler with auto ssh-add
- `src/admin/views/ssh-keys.tsx` — Deploy button UI with Linux/Windows commands
- `docs/knowledge/patterns/playwright-mcp-bundled-browser.md` — Subagent Playwright usage

## Tags

`#ssh` `#ssh-agent` `#ssh-add` `#authorized-keys` `#key-management` `#devops`
