# Admin Container Self-Destruct on Compose Recreate

## Context

The AI-EngKit admin container (`ai-engkit-admin`) has a "↻ Restart" button that recreates the container with the latest image from `ghcr.io/tryweb/ai-engkit:latest`. The challenge is that the admin server (Bun process) needs to execute a `docker compose up -d --force-recreate` command that ultimately kills its own process — a self-destruct problem.

## Problem

Three bugs were discovered in the admin restart / update check mechanism:

### Bug 1: inFlightCheck never resets (update check cache stuck)

`src/admin/routes/versions.ts` had a Promise dedup variable `inFlightCheck` that was set once and never reset to `null`. After the first update check completed, subsequent cache-expired requests would return the first check's stale result instead of re-fetching digests from ghcr.io.

```typescript
// Before: inFlightCheck was never reset
inFlightCheck = (async () => {
  // ... fetch and compare ...
  cachedCheck = { result, expiresAt: now + 300_000 };
  return result;
  // inFlightCheck is still the Promise object (truthy!)
})();

// After: reset inFlightCheck in finally
inFlightCheck = (async () => {
  try {
    // ... fetch and compare ...
    cachedCheck = { result, expiresAt: now + 300_000 };
    return result;
  } finally {
    inFlightCheck = null;  // ← allows fresh check on next cache miss
  }
})();
```

### Bug 2: Compose self-destruct kills the operation mid-way

When the admin container runs `docker compose up -d --force-recreate ai-admin`, Docker compose:
1. Creates the new container ✅
2. Starts the new container ✅  
3. Stops the old container → **kills the Bun process** → compose command aborted ❌

The new container was left in "Created" (never started) because compose was killed after creating but before starting. The old container continued running unchanged.

**Fix:** Run compose in a **separate temporary container** via `docker run --rm` that survives the admin being killed:

```typescript
await dockerCommand(
  `run --rm ` +
  `-v /opt/ai-engkit/.env:/opt/ai-engkit/.env ` +
  `-v /opt/ai-engkit/docker-compose.yml:/opt/ai-engkit/compose.yml ` +
  `-v /var/run/docker.sock:/var/run/docker.sock ` +
  `ghcr.io/tryweb/ai-engkit:latest ` +
  `sh -c "docker compose -p ${project} --env-file /opt/ai-engkit/.env -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-admin"`,
  120_000,
);
```

### Bug 3: Compose file path mismatch in temporary container

The admin container mounts the host's `docker-compose.yml` as `/opt/ai-engkit/compose.yml`. When running `docker run` in a temporary container, the volume mount must map the specific file correctly:

```yaml
# Admin container mount:
./docker-compose.yml:/opt/ai-engkit/compose.yml:rw

# docker run must mount:
-v /opt/ai-engkit/docker-compose.yml:/opt/ai-engkit/compose.yml
#                         ^^^^^^^^^^^^^^              ^^^^^^^^^^^
#                         host filename               container path
```

Using `-v /opt/ai-engkit:/opt/ai-engkit` (whole directory) fails because the host's directory has `docker-compose.yml`, not `compose.yml`.

## Solution

1. **inFlightCheck fix**: `try/finally { inFlightCheck = null; }` in the async update check
2. **Self-destruct fix**: Run compose in a `docker run --rm` temporary container
3. **File mount fix**: Mount specific file paths with the correct container-side name
4. **Version display fix**: Separate `aiEngkitVer` (read from ai-dev via `execInAiDev`) from `adminVer` (read from admin's own filesystem via `readFileSync`) — the versions table shows dev version, the mismatch badge shows admin version

## Why It Works

- The temporary container launched by `docker run --rm` is a separate Docker container from the admin. When compose stops and kills the old admin container, this temporary container continues running because it's a distinct container with its own PID namespace.
- Compose completes the full workflow (pull → create → start → stop old) because the client process isn't killed mid-way.
- The client dashboard polls `/healthz` after the admin sends the restart response, and the page reloads when the new admin is healthy.

## Side Effects / Tradeoffs

- The `docker run` command pulls the image again if not cached locally. Since the upgrade pipeline already pulled `:latest`, the image is typically cached and startup is fast.
- The temporary container runs the full entrypoint (baked skills, config init) which adds ~5-10s to the restart time. This is acceptable since restart is infrequent.
- Hotfixes applied to the running admin container are **lost** on restart because the new container starts from the production image. All fixes must be committed to the repo and released.
- When both ai-dev and ai-admin are on the same version, no mismatch badge is shown. The badge only appears when they diverge.

## Evidence

- **Bug 1**: Dashboard showed "✓ Latest" even after remote `ghcr.io` digest changed. SSH verification confirmed `localDigest ≠ remoteDigest` but API returned cached "up-to-date".
- **Bug 2**: `docker ps -a` showed a `Created` container `09bf67e8876b_ai-engkit-admin` after restart attempt. Old admin container still running on old image.
- **Bug 3**: `open /opt/ai-engkit/compose.yml: no such file or directory` error in temporary container logs.
- **Final fix**: After applying all fixes, `↻ Restart` successfully recreated admin from `15332b7a83b7 (v1.6.0)` to `44b863f386c8 (v1.6.1)`. `⚠` badge disappeared, `✓ Latest` displayed.

## Related Files

- `src/admin/routes/versions.ts` — inFlightCheck bug + getAiEngkitVersion / getLocalDigest fixes
- `src/admin/routes/admin.ts` — restart endpoint with docker run workaround
- `src/admin/server.ts` — version reading split (dev vs admin)
- `src/admin/views/dashboard.tsx` — `vv1.6.0` double-v prefix fix
- `src/admin/lib/upgrade.ts` — upgrade pipeline (only recreates ai-dev, not ai-admin)

## Tags

`#admin` `#docker` `#compose` `#self-destruct` `#restart` `#bug` `#update-check`
