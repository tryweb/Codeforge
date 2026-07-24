## Why

After installing ai-engkit, users currently face a fragmented CLI-only setup experience: they must enter the container to configure Git credentials, run `gh auth login` / `glab auth login` manually, edit `.env` with a text editor, create OpenCode projects via CLI, and run `upgrade.sh` from the host terminal. There is no unified view of installed component versions or system status. As ai-engkit deployments grow (potentially multi-instance), a centralized configuration surface becomes essential.

A lightweight web dashboard sidecar — `ai-admin` — turns these CLI chores into browser-accessible self-service operations, lowering the barrier for new users and providing a foundation for future centralized Agent management.

## What Changes

- **New `ai-admin` service** in `docker-compose.yml`: a web dashboard sidecar sharing the same image as `ai-dev`, exposing port 8080
- **`.env` configuration editor**: read/write the host `.env` file via web form, with schema validation per key
- **Version dashboard**: displays current versions of all pinned components (OpenCode, OpenChamber, Docker, gh, glab, lean-ctx, Playwright, etc.)
- **One-click upgrade**: triggers Docker API upgrade pipeline (pull + backup + merge .env + recreate) from the web UI with real-time log streaming — replaces the existing `upgrade.sh` CLI script
- **OpenCode project creation**: create new project directories in workspace, optionally initialize with `opencode --new`
- **GitHub CLI authentication**: web-guided `gh auth login` flow using device code
- **GitLab CLI authentication**: web-guided `glab auth login` flow using device code
- **Git configuration**: set `user.name` / `user.email`, view current gitconfig
- **SSH key management**: generate or import SSH keys, display public key for copy-paste
- **Future**: REST API for centralized Agent to query/control multiple instances

## Capabilities

### New Capabilities

- `env-config`: Read and edit `.env` environment variables with validation per key
- `version-dashboard`: Query and display pinned component versions from the container
- `upgrade-engine`: Trigger Docker API upgrade pipeline with real-time log streaming and status reporting — replaces `upgrade.sh`
- `project-init`: Create new OpenCode project directories in the workspace volume
- `gh-auth`: Guided GitHub CLI authentication via device code flow
- `glab-auth`: Guided GitLab CLI authentication via device code flow
- `git-config`: View and set Git user name, email, and credential helper
- `ssh-keys`: Generate, import, and display SSH public keys
- `admin-api`: REST API exposing dashboard operations for external Agent consumption

### Modified Capabilities

*(None — this is a new subsystem, not modifying existing ones.)*

## Impact

- **`docker-compose.yml`**: new `ai-admin` service block added; `ai-dev` unchanged
- **`.env`**: new variables `ADMIN_PORT`, `ADMIN_PASSWORD` (optional); existing vars become readable/editable
- **New files**: `src/admin/` — Bun/Hono server + static frontend
- **Image size**: zero additional (reuses same image, bun already installed)
- **Security**: dashboard operations require authentication; Docker socket access is restricted to upgrade + exec operations only
- **Volume footprint**: mounts host `.env` (rw), `docker-compose.yml` (rw), `backups/` (rw), and Docker socket (ro) — uses `docker compose exec` to operate inside ai-dev instead of sharing auth volumes
