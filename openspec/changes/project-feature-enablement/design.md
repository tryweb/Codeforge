## Context

The admin dashboard's Projects page (`src/admin/views/projects.tsx`) lists workspace directories and previously had an "Init OpenCode" button per project that called `opencode --new`, which is a non-existent CLI flag. The backend (`src/admin/routes/projects.ts`) also previously accepted `init_opencode` in POST body but this was already removed.

Three project-level bootstrapping capabilities exist in the image but have no UI:
1. **`enable-project-knowledge`** — bootstrap `docs/knowledge/` scaffold via `~/.config/opencode/skills/enable-project-knowledge/bootstrap.sh`
2. **`enable-finalize-maintenance`** — bootstrap `docs/knowledge/maintenance/` scaffold via bootstrap.sh; auto-invokes knowledge base bootstrap if missing
3. **`openspec init`** — initialize OpenSpec spec-driven development via `openspec init --tools opencode <path>`

All run inside the ai-dev container via `execInAiDev` (admin has docker socket access). Feature detection is done via `test -f` / `test -d` on well-known marker paths.

Additionally, the admin manages git operations: creating repos with or without remote, and setting remote URLs post-creation.

## Goals / Non-Goals

**Goals:**
- Replace broken "Init OpenCode" button with three feature enablement controls per project
- Show enabled/disabled status for each feature at a glance
- Trigger bootstrap scripts via the admin API, not requiring SSH or CLI access
- The finalize-maintenance enable should auto-provision knowledge base if not yet enabled (already handled by its bootstrap.sh)
- Support git init + optional remote URL on project creation (clone when URL given, init otherwise)
- Allow setting/changing/removing git remote URL after creation with auto-fetch for empty repos
- Batch project overview endpoint to avoid rate limiting from N*2 individual API calls

**Non-Goals:**
- Not modifying the bootstrap scripts themselves — they are baked-skill assets owned by the opencode skill system
- Not adding real-time file watching or auto-discovery of feature status changes
- Not adding per-project feature removal/uninstall

## Decisions

1. **API shape**: Two new endpoints — `GET /api/projects/:name/features` returns status object; `POST /api/projects/:name/features/:feature` triggers bootstrap. Reuse existing `execInAiDev` pattern.
2. **Status detection**: Use `test -f` / `test -d` inside the ai-dev container via `execInAiDev`. Three markers: `docs/knowledge/README.md` (knowledge), `docs/knowledge/maintenance/README.md` (maintenance), `openspec/` directory (openspec).
3. **Bootstrap execution**: Run shell commands directly via `execInAiDev`. For knowledge/maintenance: call the bootstrap.sh script. For openspec: `openspec init --tools opencode --force /home/devuser/workspace/<name>`.
4. **UI layout**: Replace the single action column with three icon+button columns. Each shows a green checkmark (enabled) or a gray "Enable" button (disabled). Use existing CSS classes (`badge-success`, `btn-outline`).
5. **Git init on creation**: If a remote URL is provided, use `git clone --depth 1 <url>` instead of mkdir + git init. This pulls files and sets up branch tracking. Without remote URL, use mkdir + optional git init.
6. **Git remote after creation**: `PUT /api/projects/:name/git-remote` handles both setting and updating the remote URL. If the repo is empty (no commits), it auto-runs `git fetch origin --depth 1` and `git checkout --track origin/main|master`. Non-git directories are auto-initialized with `git init` first.
7. **Batch overview**: `GET /api/projects/overview` returns all projects' features + git remote in one request, using internal function calls (no HTTP loopback). This prevents the projects page from hitting the 30 req/min rate limiter.
8. **Error handling**: Each bootstrap is independent — failure in one does not block others. Error messages shown via alert dialog with fallback to HTTP status text if JSON parsing fails.

## Risks / Trade-offs

- **bootstrap.sh paths are hardcoded** to `~/.config/opencode/skills/enable-*/bootstrap.sh`. If the opencode skills directory structure changes, the admin API will break silently. → Mitigation: Add `test -x` check before calling each script.
- **`openspec init` may prompt interactively** if `--force` doesn't cover all cases. → Mitigation: Use `--tools opencode --force` flags; test on a real project to confirm non-interactive behavior.
- **Concurrent enable clicks**: User could click Enable on the same feature twice. → Mitigation: Disable button during request, re-fetch status on completion.
- **Long-running scripts**: bootstrap.sh and openspec init may take several seconds. → Mitigation: Use 30s timeout on `execInAiDev`.
- **Git clone for private repos**: Requires git auth configured. → Mitigation: Check `GIT_TERMINAL_PROMPT=0` prevents interactive prompts; error message points user to GitHub/GitLab Auth page.
- **`git checkout --force` overwrites untracked files**: On repos that already have files from Knowledge/OpenSpec features, force checkout could conflict. → Mitigation: `git checkout -f` handles this by overwriting tracked files while preserving untracked ones not in the remote.
- **Rate limiter (30 req/min)**: The projects page's N*2 API calls triggered the rate limit. → Mitigation: Batch overview endpoint reduces page load to 1 API call.
