# Operations Pipeline Should Be Environment-Agnostic

## Context

The ai-admin dashboard has an upgrade pipeline (`src/admin/lib/upgrade.ts`) that
pulls the latest image, backs up config, recreates the ai-dev container, and
runs health checks. The same codebase supports both production deployments
(`docker-compose.yml` — uses `image: ghcr.io/tryweb/ai-engkit:latest`) and
development environments (`docker-compose.dev.yml` — uses `build: .`).

A developer wanted to test the upgrade flow in dev mode, which triggered a
design discussion about whether the pipeline should know which environment it
runs in.

## Problem

Adding environment detection to the pipeline (checking if compose.yml uses
`build:` vs `image:`) introduced:

1. **Branching logic** in a linear pipeline — the pull step was conditionally
   skipped, log messages changed based on mode
2. **Testing motivation** — the only reason for the change was "so devs can test
   the upgrade flow", not a production requirement
3. **Fragile detection** — parsing compose.yml with regex is brittle; changes to
   compose file formatting would silently break detection
4. **Scope creep** — the pipeline's job is "pull → backup → merge → recreate";
   knowing about dev vs production is not its responsibility

The pipeline should not need to know what environment it runs in.

## Solution

Two separate mechanisms handle the two concerns:

### 1. Version check (informing the user)

The `GET /api/versions/check-update` endpoint runs independently of the upgrade
pipeline. It compares local version against GHCR tags and reports one of:

| Local version | Result |
|---------------|--------|
| `1.2.3` (semver) | `up-to-date` or `update-available` |
| `dev` (development) | `check-failed` — "Development build" |

The Dashboard shows `? unavailable` for dev builds. This tells the user "this
environment doesn't do pull-based upgrades" without involving the pipeline.

### 2. Pre-flight guard (preventing failures)

The pipeline checks that the compose file exists before starting:
```typescript
if (!existsSync(COMPOSE_FILE)) {
  throw new Error(`Compose file not found at ${COMPOSE_FILE}.`);
}
```

This prevents cryptic `docker compose` failures regardless of environment. It
does not check for `build:` vs `image:` — that's not the pipeline's concern.

### 3. Infrastructure config (matching the environment)

The dev compose file mounts the correct compose file:
```yaml
volumes:
  - ./docker-compose.dev.yml:/opt/ai-engkit/compose.yml:rw
```

If someone runs the upgrade in dev, it will trigger a rebuild (`build: .`).
This is not "wrong" — it's what the compose file says. The pipeline executes
whatever compose file is mounted.

## Why It Works

- **Pipeline stays linear** — no environment branches, no conditional skip
- **Dev mode is self-describing** — the compose file says `build: .`, so
  `docker compose up -d --force-recreate` naturally triggers a build. No code
  needs to special-case this.
- **The version check handles UI concerns** — the badge shows "not applicable"
  for dev builds, so users aren't misled into thinking an upgrade is available
- **Failures are early and clear** — missing compose file is caught before any
  destructive operations

## Side Effects / Tradeoffs

- **Dev upgrade is slow** — triggering upgrade in dev triggers a full image
  build (2-5 minutes). This is acceptable because devs shouldn't be running
  upgrades in dev; the pipeline is designed for production.
- **No "test mode" for the pipeline** — if you want to test the pipeline logic
  without pulling/building, you need a dedicated test harness, not environment
  branches in production code.
- **The compose.yml mount is infrastructure, not application logic** — the
  dev compose file change (`docker-compose.dev.yml`) is a config fix, not a
  pipeline change. No TypeScript code was needed.

## When to Add Environment Detection

Environment detection is appropriate when:
- **Security boundaries differ** (e.g., skip TLS verify in dev)
- **External dependencies differ** (e.g., fake SMTP in dev)
- **Observability differs** (e.g., verbose logging in dev)

Environment detection is **not** appropriate when:
- The only reason is "so devs can test this feature"
- The detection is based on parsing config files with regex
- The logic branches make the code harder to reason about

## Evidence

- The `isDevMode()` function (30 lines + regex) was added and subsequently
  removed within the same session after the design discussion
- The pre-flight compose file check (`existsSync`) alone would have caught the
  missing compose file issue that triggered this whole discussion
- Dev environments continue to show `? unavailable` on the Dashboard badge via
  the existing version check mechanism, without any pipeline changes

## Related Files

- `src/admin/lib/upgrade.ts` — upgrade pipeline (environment-agnostic)
- `src/admin/routes/versions.ts` — `check-update` endpoint (handles dev mode
  in the UI layer, not the pipeline)
- `docker-compose.dev.yml` — dev config (mounts compose.yml)
- `docs/knowledge/architecture/README.md`

## Tags

`#architecture` `#pipeline` `#environment` `#single-responsibility`
`#dev-vs-prod` `#upgrade`
