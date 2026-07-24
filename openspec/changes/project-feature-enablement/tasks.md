## 1. Backend — Feature Status API

- [x] 1.1 Add `GET /api/projects/:name/features` endpoint that checks three marker paths via `execInAiDev` (`test -f docs/knowledge/README.md`, `test -f docs/knowledge/maintenance/README.md`, `test -d openspec/`) and returns `{knowledge, maintenance, openspec}` booleans
- [x] 1.2 Handle non-existent project name gracefully (return 404)

## 2. Backend — Feature Enable API

- [x] 2.1 Add `POST /api/projects/:name/features/:feature` endpoint that routes to the correct bootstrap command based on feature name
- [x] 2.2 Implement knowledge enable: `bash ~/.config/opencode/skills/enable-project-knowledge/bootstrap.sh` via `execInAiDev`
- [x] 2.3 Implement maintenance enable: `bash ~/.config/opencode/skills/enable-finalize-maintenance/bootstrap.sh` via `execInAiDev`
- [x] 2.4 Implement openspec init: `openspec init --tools opencode --force` via `execInAiDev` with 30s timeout
- [x] 2.5 Validate feature name and return 400 for invalid values
- [x] 2.6 Return bootstrap script output in response body for user feedback

## 3. Frontend — Project Table Layout

- [x] 3.1 Add `knowledge`, `maintenance`, `openspec` columns to the projects table header in `projects.tsx`
- [x] 3.2 Update `ProjectsContent` to accept feature status data alongside project names
- [x] 3.3 Render status badge (green checkmark when enabled, gray "Enable" button when disabled) for each feature per project
- [x] 3.4 Disable the Enable button during the API call to prevent double-clicks
- [x] 3.5 Add inline status text next to the button (e.g., "Enabling...", "Done") that auto-clears after 3 seconds
- [x] 3.6 Remove the old "Init OpenCode" column and button

## 4. Frontend — Fetch Feature Status on Page Load

- [x] 4.1 Update the projects page load to fetch feature statuses for all projects in parallel
- [x] 4.2 Pass feature status data into the `ProjectsContent` component
- [x] 4.3 Handle loading state (show placeholders while statuses load)

## 5. Integration & Verification

- [x] 5.1 Create a test project via admin UI and confirm three feature columns show "Enable" (disabled state)
- [x] 5.2 Click each Enable button and verify bootstrap runs successfully
- [x] 5.3 Reload the page and verify the status shows as enabled (green checkmark)
- [x] 5.4 Verify that enabling maintenance on a project without knowledge base auto-enables knowledge base too
- [x] 5.5 Verify `openspec init` creates the `openspec/` directory inside the project
- [x] 5.6 Confirm no console errors in the projects page
