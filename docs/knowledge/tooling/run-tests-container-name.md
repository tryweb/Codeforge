# Dev test container resolution and Compose project isolation

## Context

Dev integration tests must run against the `dev` Compose project only. An
unscoped container lookup can resolve a production container when dev is
stopped, and an unscoped `docker compose -f docker-compose.dev.yml` command
resolves the project from the directory name instead of `dev`.

## Problem

Two historical failure modes:

1. **Wrong default name:** `test/run-tests.sh` once defaulted to `ai-dev`
   while `docker-compose.dev.yml` defines `container_name: ai-engkit-dev`,
   so a bare invocation targeted a nonexistent container.
2. **Listing-order detection:** automation once used
   `docker compose ps --format '{{.Name}}' | head -1`, which returns the
   admin container first (Compose definition order) and produced false
   test failures on the wrong container.

A related DooD pitfall: `PUBLISHED_PORT=$(docker port ... | head -1 | sed ... || echo "$ADMIN_PORT")`
only falls back when the pipeline exits non-zero. Empty output still built a
malformed `http://<gateway>:` URL.

## Solution

- Default container name is `ai-engkit-dev`; a positional argument still
  wins. When the default name is not running, scripts fall back to label
  discovery scoped to the dev project:
  `docker ps --filter 'label=com.docker.compose.project=dev' --filter 'label=com.docker.compose.service=ai-dev' --filter 'status=running'`.
  Admin scripts use `service=ai-admin` with the same project filter.
- The check-updates skill resolves the service without depending on listing
  order: `docker compose -p dev -f docker-compose.dev.yml ps -q ai-dev`.
- Mutating or admin scripts (`run-tests.sh`, `test-admin.sh`,
  `test-admin-ui.sh`, `test-agent-model-e2e.sh`) refuse non-dev Compose
  projects via the `com.docker.compose.project` inspect label.
  `run-tests.sh` additionally fails closed when no container is selected or
  the project label is unreadable.
- Dev tests use only `ADMIN_DEV_PORT` (default `8081`) and
  `CHAMBER_DEV_PORT` (default `8001`); production `ADMIN_PORT` and
  `CHAMBER_PORT` are intentionally ignored to prevent inherited production
  environment values from redirecting dev tests.
  `test-full.sh` exports the effective `CHAMBER_DEV_PORT` before invoking
  `run-tests.sh`.
- Published-port resolution uses an explicit empty fallback:
  `PUBLISHED_PORT="${PUBLISHED_PORT:-$ADMIN_PORT}"`, so empty `docker port`
  output can never build a malformed URL.
- `test/test-compose-isolation.sh` guards all of the above: tool preflight,
  `-p dev` on every dev Compose invocation, project-scoped label fallbacks,
  no hardcoded admin `docker port` names, no `|| echo` port fallbacks, and
  no production network names.

## Why It Works

Label filters survive `container_name` overrides (CI renames containers),
while the project filter keeps discovery inside `dev`. The refusal guards
turn a wrong-container run into an immediate, explicit failure instead of
silent false results. Explicit empty-port fallback handles the case `|| echo`
misses.

## Side Effects / Tradeoffs

- Tests require the `dev` Compose project; a container without Compose
  labels is refused rather than tested.
- `test-full.sh` still performs real `down`/`build`/`up` cycles; the
  isolation guard itself is read-only.

## Evidence

- `bash -n` clean on all touched scripts.
- `test/test-compose-isolation.sh` passes on the hardened tree and matches
  synthetic regressions (hardcoded `docker port`, `|| echo` fallback,
  unscoped `docker compose -f`, project-less label filter).

## Related Files

- `test/run-tests.sh` (default/label/positional resolution, fail-closed project refusal, `CHAMBER_DEV_PORT` precedence)
- `test/test-admin.sh` (admin label resolution, project refusal, `ADMIN_DEV_PORT` precedence, empty-port fallback)
- `test/test-admin-ui.sh` (admin label resolution, project refusal, scoped ai-dev fallback, empty-port fallback)
- `test/test-full.sh` (`CHAMBER_DEV_PORT` fallback and export)
- `test/test-memory-e2e.sh`, `test/test-agent-model-e2e.sh`, `test/leanctx-reliability-gate.sh` (project-scoped ai-dev discovery)
- `test/test-compose-isolation.sh` (isolation guard)
- `.opencode/skills/check-updates/SKILL.md` (order-independent `ps -q ai-dev` resolution)

## Tags

- testing
- docker-compose
- dev-environment
- check-updates
