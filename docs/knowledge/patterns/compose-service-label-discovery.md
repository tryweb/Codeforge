# Compose Service Label Container Discovery

## Context

The ai-engkit admin server and its test scripts need to target the ai-dev
container (`docker exec`). Container names are not stable across environments:

- dev compose: `container_name: ai-engkit-dev`
- prod compose: `container_name: ai-engkit`
- **CI**: the workflow override renames it to `container_name: ci-test`

Name-based discovery (derive sibling name via `-admin` suffix stripping, then
`docker ps --filter name=^/<name>$`) silently fails in CI: the derived name
`ai-engkit-dev` matches nothing, the fallback `docker exec ai-engkit-dev`
returns "No such container", and callers see 500s or skipped tests.

## Problem

Two failure surfaces, one root cause:

1. **Admin server** — `getAiDevContainerRef()` (src/admin/lib/docker.ts)
   derived the dev container name from the admin container's own name
   (`ai-engkit-admin-dev` → `ai-engkit-dev`). Under CI's `container_name:
   ci-test` override, `docker ps --filter name=^/ai-engkit-dev$` found
   nothing and exec failed with exit code 1 → `AuthStoreReadError` → 500.
   Symptom in CI: `PUT /api/providers/<name>/keys/<id>/active` returned 500
   for non-key-managed providers (the route read the auth snapshot via
   `execInAiDev` unconditionally before commit 4013265).

2. **Test scripts** — 5 scripts defaulted to hardcoded names:
   `ai-engkit-dev` (test-admin-ui.sh, test-memory-e2e.sh, run-tests.sh),
   `ai-engkit-admin-dev` (test-admin.sh), or the service name `ai-dev`
   (run-tests.sh, test-full.sh — never an actual container name). The
   project registration E2E skipped in CI ("ai-engkit-dev container not
   running") because the container was `ci-test`.

## Solution

Discover the container via its **compose service label** — Docker Compose
sets `com.docker.compose.service=<service>` on every container it creates,
and this label does **not** change when `container_name` is overridden.

### Admin server (src/admin/lib/docker.ts)

```typescript
// Scoped to this admin's own compose project so other stacks on the host
// don't leak in; falls back to the legacy name derivation.
async function getAiDevContainerByService(): Promise<string> {
  const selfRef = await getSelfContainerRef();
  const projectResult = await dockerCommand(
    `inspect --format='{{index .Config.Labels "com.docker.compose.project"}}' ${selfRef}`,
    5_000,
  );
  const project = projectResult.exitCode === 0 ? projectResult.stdout.trim() : "";
  const filters = ["status=running", "label=com.docker.compose.service=ai-dev"];
  if (project) filters.push(`label=com.docker.compose.project=${project}`);
  const args = ["docker", "ps", "--format", "{{.ID}}"];
  for (const filter of filters) args.push("--filter", filter);
  const result = await runCommand(args, 10_000);
  return result.exitCode === 0 && result.stdout.trim()
    ? result.stdout.trim().split("\n")[0]
    : "";
}

export async function getAiDevContainerRef(): Promise<string> {
  const byService = await getAiDevContainerByService();
  if (byService) return byService;
  // legacy name derivation as fallback (non-compose deployments)
  const devName = await getSiblingDevContainerName();
  // ... docker ps by exact name ...
  return devName;
}
```

`getComposeProject()` was also fixed to read the project label from the
admin's **own** container instead of the derived dev container name.

### Test scripts (test/*.sh)

Uniform resolution order in all 5 scripts:
explicit argument → legacy name (if the container exists) → service label
query → legacy name again (skip path):

```bash
CONTAINER="${1:-ai-engkit-dev}"                       # or CONTAINER_NAME
if [ "$CONTAINER" = "ai-engkit-dev" ] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=ai-dev' \
               --filter 'status=running' --format '{{.Names}}' 2>/dev/null | head -n 1)"
fi
CONTAINER="${CONTAINER:-ai-engkit-dev}"
```

- `test-admin.sh` uses `label=com.docker.compose.service=ai-admin`.
- `test-full.sh` keeps its `CONTAINER_NAME` env interface, legacy name
  `ai-engkit` (matches compose.yml).

## Why It Works

- `com.docker.compose.service` is assigned by Docker Compose at creation time
  from the compose file's service key (e.g. `ai-dev`), independent of
  `container_name`. Renaming the container (CI override) does not change the
  label.
- Scoping by the admin's own `com.docker.compose.project` label prevents
  picking up an ai-dev container from a different compose stack running on
  the same host (prod + dev coexist).
- Legacy-name-first keeps local dev behavior identical (dev compose names the
  container `ai-engkit-dev`, which exists) — the label path only activates
  when the legacy name is absent, exactly the CI case.

## Side Effects / Tradeoffs

- **Label scope**: the project label filter requires the admin container to
  itself be compose-managed; non-compose deployments fall through to the
  name-derivation fallback unchanged.
- **Multiple candidates**: `head -n 1` picks one if several containers share
  the service label within the same project; with prod + dev stacks on one
  host, the project scoping keeps them distinct.
- **chromium-1234-style pins in .grype.yaml**: unrelated to container
  discovery, but the same principle (label/location-based matching over
  name-based) applies — see the grype ignore entry.

## Evidence

- Before fix: CI run 31774395761 — `PUT active key returned 500 (expected
  200)` + `Active key selection wrong (stale:k-...)`; `SKIP project
  registration E2E (ai-engkit-dev container not running)`.
- Local repro: `docker run --name ci-test-sim --label
  com.docker.compose.service=ai-dev ...` → `getAiDevContainerRef()` returned
  `da46015faa5d` (ci-test-sim) instead of the legacy fallback; `execInAiDev`
  exited 0.
- CI run 31776962499 (admin fix): Integration Tests success, 161 + 8 + 50.
- CI run 31777992588 (test script fix): admin UI suite 50 → 56 passed, 0
  failed, zero `SKIP project registration E2E` lines.
- Local: `docker ps --filter label=com.docker.compose.service=ai-dev` lists
  renamed containers correctly; `docker inspect <container> --format
  '{{index .Config.Labels "com.docker.compose.project"}}'` returns the
  project.

## Related Files

- `src/admin/lib/docker.ts` — `getAiDevContainerByService`,
  `getAiDevContainerRef`, `getComposeProject`
- `src/admin/routes/providers.ts` — PUT active route (guard snapshot read
  behind `isKeyProviderSupported`, commit 4013265)
- `test/test-admin-ui.sh`, `test/run-tests.sh`, `test/test-memory-e2e.sh`,
  `test/test-admin.sh`, `test/test-full.sh` — container resolution blocks
- `docs/knowledge/patterns/env-aware-sibling-container.md` — the previous
  name-derivation approach this replaces for the compose case
- `docs/knowledge/tooling/run-tests-container-name.md` — run-tests.sh
  container-name pitfalls (now resolved by label fallback)
- `docker-compose.dev.yml`, `docker-compose.override.yml` (generated in CI
  with `container_name: ci-test`)

## Tags

`container-detection`, `docker-compose`, `labels`, `ci`, `dood`,
`exec-in-ai-dev`, `test-scripts`, `container-name-override`
