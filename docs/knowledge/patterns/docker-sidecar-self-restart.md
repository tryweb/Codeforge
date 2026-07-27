# Docker Sidecar Self-Restart Pattern

## Context

ai-admin is a Docker sidecar container that manages the ai-dev container. After an upgrade, ai-dev is recreated with the new image, but ai-admin stays on the old version. Users need to restart ai-admin from the dashboard to sync versions.

## Problem

When a container restarts itself via an HTTP API endpoint, the server process dies mid-request, causing the client to receive a connection error instead of the success response. A plain `docker restart` also keeps the old container image, so it cannot synchronize `ai-admin` after `ai-dev` has been upgraded.

In Docker-out-of-Docker (DooD) deployments, a second path problem occurs: `/opt/ai-engkit/.env` and `/opt/ai-engkit/compose.yml` are paths inside the admin container, while bind-mount sources are resolved by the host Docker daemon. Hardcoding the container paths in a helper `docker run` can create host-side directories and fail with `EISDIR` or `permission denied`.

## Solution

Response-first recreate pattern: send the HTTP response BEFORE starting an independent helper container, then run Compose with `--force-recreate ai-admin`.

```typescript
// POST /api/admin/restart
admin.post("/api/admin/restart", async (c) => {
  // 1. Send response FIRST (before restart begins)
  const responsePromise = c.json({ ok: true, message: "Admin pulling latest image and recreating..." });
  
  // 2. Resolve host-side bind sources from docker inspect
  const envSource = await getSelfBindSource("/opt/ai-engkit/.env");
  const composeSource = await getSelfBindSource("/opt/ai-engkit/compose.yml");

  // 3. Schedule recreate in a helper after response is sent
  setTimeout(async () => {
    await dockerCommand(
      `run --rm --user 0 --entrypoint sh ` +
      `-v ${shellQuote(envSource)}:${shellQuote(envSource)}:ro ` +
      `-v ${shellQuote(composeSource)}:${shellQuote(composeSource)}:ro ` +
      `-v /var/run/docker.sock:/var/run/docker.sock ` +
      `ghcr.io/tryweb/ai-engkit:latest -c ` +
      `${shellQuote(`docker compose -p ${shellQuote(project)} ` +
        `--env-file ${shellQuote(envSource)} -f ${shellQuote(composeSource)} ` +
        `up -d --force-recreate ai-admin`)}`,
      120_000,
    ).catch(() => {});
  }, 2000);
  
  // 4. Return response (sent to client before container dies)
  return responsePromise;
});
```

Client-side polling for reconnection:

```javascript
async function restartAdmin() {
  const res = await fetch("/api/admin/restart", { method: "POST" });
  if (res.ok) {
    // Poll healthz until admin is back
    const poll = setInterval(async () => {
      try {
        const h = await fetch("/healthz");
        if (h.ok) { clearInterval(poll); location.reload(); }
      } catch {} // still down, keep polling
    }, 1000);
  }
}
```

## Why It Works

- **Response sent before restart**: The `c.json()` creates a response object, but it's not sent until the handler returns. The `setTimeout` schedules the restart 2 seconds later, giving time for the response to flush.
- **No race condition**: The response is returned from the handler, ensuring it's fully sent before the event loop processes the `setTimeout` callback.
- **Independent helper**: The helper is not stopped when Compose recreates `ai-admin`.
- **Force recreate**: `docker restart` only restarts the existing container; `up -d --force-recreate ai-admin` attaches the service to the latest pulled image.
- **Host paths**: `getSelfBindSource()` reads `.Mounts[].Source`; the helper mounts each source at the same absolute path so the host Docker daemon resolves Compose bind mounts correctly.
- **Root helper**: `--user 0` allows the helper to read host files such as root-owned `.env` files.

## Version Mismatch Detection

Compare image digests between containers:

```typescript
async function getAdminImageDigest(): Promise<string | null> {
  const ref = await getSelfContainerRef(); // reads /etc/hostname
  const result = await dockerCommand(`inspect --format='{{.Image}}' ${ref}`, 10_000);
  return result.exitCode === 0 && result.stdout ? result.stdout.trim() : null;
}

async function getAiDevImageDigest(): Promise<string | null> {
  const result = await dockerCommand(`inspect --format='{{.Image}}' ai-engkit`, 10_000);
  return result.exitCode === 0 && result.stdout ? result.stdout.trim() : null;
}

const adminVersionMismatch = adminDigest !== null && aiDevDigest !== null && adminDigest !== aiDevDigest;
```

## Side Effects / Tradeoffs

- **Brief downtime**: Client experiences ~3-12 seconds of unavailability during restart (connection refused while container recreates).
- **Session loss**: Authentication cookies are in-memory; user must re-login after restart.
- **Response timing**: The 2-second delay is conservative; could be reduced to 500ms but risks response not flushing before restart.
- **Polling overhead**: Client polls `/healthz` every 1 second during restart; negligible for single-user admin dashboard.

## Evidence

- Tested on remote machine (192.168.11.195):
  - Initial plain Restart returned successfully but left `ai-admin` on `v1.6.2` and digest `sha256:59287e…`.
  - Host-aware helper recreated `ai-admin`; both containers became `v1.6.3` with digest `sha256:961fe45…`.
  - With the host-aware endpoint injected, `POST /api/admin/restart` returned `200`, and the admin container ID changed from `4ef246…` to `369e469…`.
- Tested on remote machine (192.168.11.194):
  - Dashboard upgrade changed `ai-dev` from `v1.6.2` to `v1.6.3`, while `ai-admin` remained `v1.6.2`.
  - Helper using `/home/jonathan/.env`, `/home/jonathan/docker-compose.yml`, and project `jonathan` recreated `ai-admin` successfully.
  - Dashboard showed `v1.6.3 ✓ Latest`; `/api/status` returned `admin_version_mismatch: false`.
- Local `docker build --tag ai-engkit-restart-fix:test .` completed successfully after the implementation change.

## Related Files

- `src/admin/routes/admin.ts` — `/api/admin/status`, `/api/admin/restart`
- `src/admin/views/dashboard.tsx` — `restartAdmin()` function, version mismatch UI
- `src/admin/routes/status.ts` — `/api/status` with `admin_version_mismatch` field
- `src/admin/lib/docker.ts` — `getSelfContainerRef()`, `getSelfBindSource()`, `dockerCommand()`
- `docker-compose.yml` — `restart: unless-stopped` policy

## Tags

- docker
- sidecar
- self-restart
- response-first
- version-mismatch
- admin-dashboard
