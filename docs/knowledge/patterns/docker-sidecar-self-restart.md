# Docker Sidecar Self-Restart Pattern

## Context

ai-admin is a Docker sidecar container that manages the ai-dev container. After an upgrade, ai-dev is recreated with the new image, but ai-admin stays on the old version. Users need to restart ai-admin from the dashboard to sync versions.

## Problem

When a container restarts itself via an HTTP API endpoint, the server process dies mid-request, causing the client to receive a connection error instead of the success response.

## Solution

Response-first restart pattern: send the HTTP response BEFORE triggering the restart.

```typescript
// POST /api/admin/restart
admin.post("/api/admin/restart", async (c) => {
  // 1. Send response FIRST (before restart begins)
  const responsePromise = c.json({ ok: true, message: "Admin will restart in 2 seconds..." });
  
  // 2. Schedule restart in background after response is sent
  setTimeout(async () => {
    await dockerCommand("restart ai-engkit-admin", 30_000).catch(() => {});
  }, 2000);
  
  // 3. Return response (sent to client before container dies)
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
- **Restart policy fallback**: Even if the explicit `docker restart` fails, Docker's `restart: unless-stopped` policy ensures the container comes back.

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
  - `POST /api/admin/restart` returns `{"ok":true,"message":"Admin will restart in 2 seconds..."}`
  - Admin container status: `Up 5 seconds (health: starting)` → `healthy` in ~12 seconds
  - Health endpoint returns `{"status":"ok"}` after restart
  - Session preserved if re-login performed

## Related Files

- `src/admin/routes/admin.ts` — `/api/admin/status`, `/api/admin/restart`
- `src/admin/views/dashboard.tsx` — `restartAdmin()` function, version mismatch UI
- `src/admin/routes/status.ts` — `/api/status` with `admin_version_mismatch` field
- `src/admin/lib/docker.ts` — `getSelfContainerRef()`, `dockerCommand()`
- `docker-compose.yml` — `restart: unless-stopped` policy

## Tags

- docker
- sidecar
- self-restart
- response-first
- version-mismatch
- admin-dashboard
