## ADDED Requirements

### Requirement: Git remote query
The system SHALL expose a `GET /api/projects/:name/git-remote` endpoint that returns the current origin remote URL, or `null` if none is set.

#### Scenario: Has remote
- **WHEN** the project has a git remote named `origin`
- **THEN** the endpoint returns `{"remote": "https://github.com/org/repo.git"}`

#### Scenario: No remote
- **WHEN** the project has no git remote
- **THEN** the endpoint returns `{"remote": null}`

### Requirement: Git remote set/update/remove
The system SHALL expose a `PUT /api/projects/:name/git-remote` endpoint that sets, updates, or removes the origin remote URL.

#### Scenario: Set remote on non-git directory
- **WHEN** `PUT /api/projects/my-app/git-remote` with `{"remote": "https://github.com/org/repo.git"}` and the directory is not a git repo
- **THEN** the system auto-runs `git init` before setting the remote

#### Scenario: Set remote on empty repo
- **WHEN** the repo has no commits yet
- **THEN** after setting the remote, the system runs `git fetch origin --depth 1` and `git checkout --track origin/main` (or master)

#### Scenario: Update existing remote URL
- **WHEN** the repo already has an origin remote
- **THEN** the system runs `git remote set-url origin <new-url>` instead of `git remote add`

#### Scenario: Remove remote
- **WHEN** `{"remote": ""}` is sent
- **THEN** the system removes the origin remote

### Requirement: Git init on project creation
When creating a project with `git_init: true` and a `git_remote` URL, the system SHALL clone the remote instead of creating an empty directory.

#### Scenario: Clone with remote URL
- **WHEN** `POST /api/projects` receives `{"name": "my-app", "git_init": true, "git_remote": "https://github.com/org/repo.git"}`
- **THEN** the system runs `git clone --depth 1 <url> <project-dir>`

#### Scenario: Local init without remote
- **WHEN** `POST /api/projects` receives `{"name": "my-app", "git_init": true}` without a remote URL
- **THEN** the system runs `mkdir -p` then `git init`
