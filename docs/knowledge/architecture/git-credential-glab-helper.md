# Git Credential Helper for glab Token

## Context

The admin dashboard runs `git fetch origin --depth 1` inside the `ai-engkit`
container to validate remotes when users set a project's Git remote URL via the
Projects page (`/projects`). These commands are executed via `docker exec` through
`execInAiDev()` in `/opt/admin/lib/docker.ts` — a non-interactive environment.

glab CLI stores GitLab access tokens in `~/.config/glab-cli/config.yml`. Git
itself does not read this file. The `credential.helper=store` mechanism writes
tokens in plaintext to `~/.git-credentials`, creating a security concern.

## Problem

Two separate authentication systems, no bridge between them:

```
glab CLI:  token in ~/.config/glab-cli/config.yml  (glab-only)
git:       credential.helper=store → ~/.git-credentials (plaintext)
```

When the admin UI runs a plain `git fetch origin` (not through glab), git
queries its credential helpers. With `credential.helper=store` and an empty
`~/.git-credentials`, git has no credentials for HTTPS remotes. Combined with
`GIT_TERMINAL_PROMPT=0` (no interactive prompts), git fails with:

```
fatal: could not read Username for 'https://gitlab.example.com': No such device or address
```

Previously solved by writing the token directly to `~/.git-credentials`:
```
https://user:TOKEN@gitlab.example.com
```
This works but stores the access token in plaintext on disk — the `store`
helper is a simple text file with no encryption.

## Solution

A **git credential helper script** (`git-credential-glab`) that implements git's
credential helper protocol by reading tokens from glab's `config.yml` at runtime:

```
git fetch origin --depth 1
  → git checks credential.https://host.helper=glab
  → git-credential-glab reads stdin for hostname
  → reads ~/.config/glab-cli/config.yml via python3 yaml
  → outputs username=<user>, password=<token> on stdout
  → git authenticates successfully
  → token never written to disk
```

### Implementation

The helper is a 30-line shell script deployed to `~/.local/bin/git-credential-glab`
in the ai-engkit container. Git discovers it automatically because `~/.local/bin`
is in `PATH` and git looks for `git-credential-<name>` executables.

```sh
#!/bin/sh
GLAB_CONFIG="${HOME}/.config/glab-cli/config.yml"
HOST=""
while IFS="=" read -r key value; do
  case "$key" in
    host) HOST="$value" ;;
  esac
done
[ -z "$HOST" ] && exit 0
[ ! -f "$GLAB_CONFIG" ] && exit 0
python3 -c "
import yaml, sys, os
glab_cfg = os.path.expanduser('~/.config/glab-cli/config.yml')
with open(glab_cfg) as f:
    cfg = yaml.safe_load(f)
hosts = cfg.get('hosts', {})
hostname = sys.argv[1]
if hostname in hosts:
    h = hosts[hostname]
    token = h.get('token', '')
    if token:
        user = h.get('user', 'oauth2')
        print(f'username={user}')
        print(f'password={token}')
" "$HOST"
```

Git is configured per-host so the helper only runs for relevant remotes:

```
git config --global credential.https://gitlab.example.com.helper glab
git config --global credential.http://gitlab.example.com.helper glab
```

The global `credential.helper=store` is **removed** to prevent git from caching
credentials back to plaintext after the helper returns them.

### Auto-deployment on glab login

In `src/admin/routes/glab-auth.ts`, the `setupGlabCredentialHelper(hostname)`
function is called after a successful `glab auth login`:

```typescript
async function setupGlabCredentialHelper(hostname: string): Promise<void> {
  // 1. Deploy helper script via base64-encoded heredoc
  // 2. Remove global credential.helper=store
  // 3. Set per-host credential helper for http:// and https://
  // 4. Clear any residual ~/.git-credentials
}
```

## Why It Works

- **Single source of truth**: The token lives only in glab's `config.yml`. No
  duplication, no sync issues.
- **Zero plaintext on disk**: The credential helper reads the token at runtime
  and returns it to git via stdout. The token is never written to a separate file.
- **Standard git protocol**: Git's credential helper protocol is the intended
  mechanism for this — same pattern used by GitHub CLI (`gh auth git-credential`),
  GitLab CLI (`glab auth configure-docker`), and others.
- **Per-host scoping**: URL-scoped git config limits the helper to specific
  hosts, avoiding interference with other remotes (GitHub, etc.).

## Side Effects / Tradeoffs

- **Python dependency**: The helper requires `python3` with `yaml` module in
  the ai-engkit container (present by default).
- **One-time deployment gap**: The credential helper is only deployed when
  `glab auth login` runs. If glab was configured manually (editing config.yml),
  the helper is not auto-deployed. Mitigation: add a startup health check to
  auto-deploy on container restart.
- **No `store` caching**: Without `credential.helper=store`, git re-queries
  the helper on every operation. For frequently accessed repos, this adds
  ~50ms per credential check. Acceptable for development workflows.
- **No interactive fallback**: If the helper fails (e.g., token expired), git
  has no credential source and fails. Users must re-authenticate via the
  GitLab Auth page.

## Evidence

- `~/.git-credentials` stays at 0 bytes after `git fetch` ✅
- Credential helper correctly returns token from glab config ✅
- `git fetch origin --depth 1` exits 0 with `GIT_TERMINAL_PROMPT=0` ✅
- Tested on ai-engkit-194 with remote repo auth ✅

## Related Files

- `src/admin/routes/glab-auth.ts` — `setupGlabCredentialHelper()` function,
  `parseGlabInstances()`
- `src/admin/routes/projects.ts` — `PUT /api/projects/:name/git-remote` handler
  (removed `GIT_TERMINAL_PROMPT=0`)
- `src/admin/routes/git-config.ts` — removed `/api/git/credentials` endpoint
- `src/admin/views/git-config.tsx` — removed "Stored Credentials" UI section
- `docs/knowledge/tooling/glab-multi-instance-auth.md` — related glab auth setup
- `docs/knowledge/tooling/ssh-key-agent-workflow.md` — SSH key alternative

## Tags

`#git` `#credentials` `#glab` `#security` `#credential-helper` `#gitlab` `#auth`
