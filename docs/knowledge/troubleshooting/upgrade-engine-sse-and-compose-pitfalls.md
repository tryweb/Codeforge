# Upgrade Engine: SSE Streaming and Docker Compose Pitfalls

## Context

AI-EngKit Admin Dashboard's "Upgrade Engine" feature runs `upgrade.sh` logic from the browser. The upgrade pipeline has 6 steps:
1. `digest_compare` — Pull latest image, compare digests
2. `backup` — Create pre-upgrade backup
3. `merge_env` — Merge new env vars
4. `recreate` — Recreate ai-dev container
5. `poll_health` — Wait for ai-dev to become healthy
6. `cleanup` — Prune old images

Each step emits SSE events via `GET /api/upgrade/log`. The frontend uses `EventSource("/api/upgrade/log")` to receive real-time progress.

## Problem

Clicking "Start Upgrade" showed "Progress" heading but no events appeared. The pipeline hung at step 5 (`poll_health`) for 120s timeout, then the admin container was killed by step 6 before emitting success.

**Root causes (3 bugs + 1 design issue):**

1. **SSE `Content-Type` header lost**: `return new Response(stream)` discards headers set via `c.header()` in Hono. Browser `EventSource` requires `text/event-stream` MIME type — without it, EventSource aborts with MIME type error.

2. **`pollAiDevHealth` broken compose command**: Called `composeCommand("ps ...")` without `-p project -f compose.yml`. Error: `no configuration file provided: not found`. Health check always timed out after 120s.

3. **Admin self-restart kills SSE stream**: Cleanup step ran `docker compose up -d --force-recreate ai-admin` BEFORE `emit("cleanup", "success")`. SSE stream terminated before success event reached client.

4. **Backups directory ownership**: `/opt/ai-engkit/backups` owned by `root:root` (755) but admin container runs as `devuser` (uid=1000). Step 2 (`backup`) failed with `EACCES: permission denied`.

## Solution

**Fix 1 — SSE Content-Type** (`src/admin/routes/upgrade.ts`):
```typescript
// Before (broken):
return new Response(stream);

// After (fixed):
return c.body(stream);
```
`c.body()` preserves all `c.header()` settings. `new Response()` creates a fresh Response that ignores Hono's header state.

**Fix 2 — Health Check** (`src/admin/lib/upgrade.ts`):
```typescript
// Before (broken):
const result = await composeCommand("ps --filter status=running --format json", 10_000);
if (result.exitCode === 0 && result.stdout.includes("ai-engkit")) {

// After (fixed):
if (await isAiDevRunning()) {
```
`isAiDevRunning()` uses `docker ps --filter name=ai-engkit --filter status=running` — works without compose file context.

**Fix 3 — Remove admin restart** (`src/admin/lib/upgrade.ts`):
```typescript
// Before (killed SSE):
await dockerCommand("image prune -f", 60_000);
await dockerCommand(`compose -p ${project} ... up -d --force-recreate ai-admin`, 120_000);
emit("cleanup", "success", "Upgrade complete");

// After (preserves SSE):
await dockerCommand("image prune -f", 60_000);
emit("cleanup", "success", "Upgrade complete");
```

**Fix 4 — Backups permission** (`entrypoint.d/00-fix-perms.sh`):
```bash
fix_perms /opt/ai-engkit/backups
```

## Why It Works

- `c.body(stream)` is Hono's canonical way to return streaming responses. It wraps the ReadableStream and preserves all headers set via `c.header()`.
- `isAiDevRunning()` queries Docker daemon directly (`docker ps --filter`) instead of requiring compose project context.
- Removing admin restart from the pipeline means the SSE stream stays alive until the success event is emitted. Admin version display may show stale info until manual restart — acceptable tradeoff.
- `fix_perms` in entrypoint ensures backups directory is owned by devuser (1000:1000) on every container start.

## Side Effects / Tradeoffs

- **Admin version staleness**: After upgrade, admin container version display may show old version until manual restart. Previously, admin self-restarted to pick up new image. This is acceptable because:
  - The upgrade succeeded (ai-dev is running new image)
  - Admin restart can be triggered manually from UI or CLI
  - SSE stream preservation is more important than auto-refresh

## Evidence

- **SSE fix verified**: `curl -D - http://localhost:8080/api/upgrade/log` returned `Content-Type: text/event-stream`
- **Full pipeline test**: All 6 steps completed in ~2 seconds (previously hung at step 5 for 120s)
- **Browser verification**: Playwright showed all 12 SSE events (6 steps × running/success) in Progress panel
- **Container health**: Both `ai-engkit` and `ai-engkit-admin` remained running after upgrade

## Related Files

- `src/admin/routes/upgrade.ts` — SSE endpoint (`/api/upgrade/log`)
- `src/admin/lib/upgrade.ts` — Upgrade pipeline logic
- `src/admin/lib/docker.ts` — Docker helpers (`isAiDevRunning`, `composeCommand`, `dockerCommand`)
- `src/admin/views/upgrade.tsx` — Frontend EventSource client
- `entrypoint.d/00-fix-perms.sh` — Container startup permission fixes

## Tags

sse, streaming, hono, docker, compose, permissions, upgrade, eventsource, content-type
