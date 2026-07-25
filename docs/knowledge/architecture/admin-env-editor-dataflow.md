# Admin Env Editor Dataflow

## Context

ai-admin (sidecar container) provides a web UI to view and edit environment variables. The editor reads/writes `/opt/ai-engkit/.env` and offers a "Restart ai-dev" button to apply changes.

## Problem

The env editor must work correctly in two fundamentally different deployment modes:

- **Production** (`docker-compose.yml`): Docker daemon and compose files share the same filesystem. Bind mounts of individual files work normally.
- **Dev** (`docker-compose.dev.yml`, DooD mode): Docker daemon runs on the host; the admin container is a sibling. Bind mounts of single files fail silently (Docker creates empty directories at the destination instead).

## Solution

### File Access Strategy

| Layer | Production | Dev (DooD) |
|-------|-----------|-------------|
| `.env` location | `/opt/ai-engkit/.env` (bind-mounted from host `./.env`) | `/opt/ai-engkit/.env` (container-local, no host propagation) |
| Write path | `writeFileSync("/opt/ai-engkit/.env")` → directly modifies host file | Same path, but the file stays inside the admin container |
| Read path | `readFileSync("/opt/ai-engkit/.env")` | Same |
| Startup .env loading | Bind mount makes the file available at container start | `env_file: .env` + `env | grep -v` dump in startup command |

### Restart Strategy (applying changes)

```
POST /api/env/restart
  → getAiDevContainerRef()  // "ai-engkit-dev" or "ai-engkit"
  → if /opt/ai-engkit/compose.yml exists (production):
      docker compose -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-dev
      // Docker Compose re-reads .env → new container gets updated vars ✅
  → else (dev / DooD):
      docker restart <ref>
      // Restarts the service, but original env vars are preserved ❌
```

### Why Compose Recreate Works in Production

The production compose mounts both files the admin needs:

```yaml
volumes:
  - ./.env:/opt/ai-engkit/.env:rw          # write edits → host .env
  - ./docker-compose.yml:/opt/ai-engkit/compose.yml:rw  # compose recreate
  - /var/run/docker.sock:/var/run/docker.sock:ro        # run docker cmds
```

`docker compose up -d --force-recreate` reads `.env` from the compose project directory at invocation time. Since the admin writes to the bind-mounted `.env`, the host file is always current before the recreate runs.

## Why It Works

- Production bind mounts are reliable because Docker daemon and files are on the same host.
- Dev uses `env_file` + startup dump to work around DooD's inability to bind-mount files.
- The dual-path restart logic (compose vs plain restart) matches the deployment mode.

## Side Effects / Tradeoffs

- **Dev cannot apply new env vars via the editor.** `docker restart` preserves original container env. Only a full `docker compose down && up -d` from the host shell picks up new vars.
- **Dev startup dump includes non-.env vars** (e.g., `PLAYWRIGHT_VERSION`, `DEBIAN_FRONTEND`). Filtered with `grep -v` blacklist, but the blacklist must stay in sync with the image.
- **Compose recreate drops the container and creates a new one.** Short downtime during recreation. Running processes inside ai-dev are killed.
- **There is no DELETE endpoint** for env vars. Setting a value to `""` leaves `KEY=` in the file.

## Evidence

- Production compose mounts: `docker-compose.yml` lines 38-42
- Dev startup command: `docker-compose.dev.yml` `command:` field
- Restart endpoint: `src/admin/routes/env.ts`
- Env file read/write: `src/admin/lib/env.ts`

## Related Files

- `src/admin/routes/env.ts` — env API routes and restart logic
- `src/admin/lib/env.ts` — .env file read/write
- `src/admin/views/env-editor.tsx` — editor UI and restart button
- `src/admin/lib/docker.ts` — `dockerCommand`, `execInAiDev`, `getAiDevContainerRef`
- `docker-compose.yml` — production mounts
- `docker-compose.dev.yml` — dev mode env_file + startup dump
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — DooD bind mount root cause

## Tags

`env-editor` `dataflow` `dood` `bind-mount` `docker-compose` `env-file` `restart`
