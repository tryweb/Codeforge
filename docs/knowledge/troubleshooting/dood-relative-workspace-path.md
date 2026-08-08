# DooD Admin Upgrades Require an Absolute `WORKSPACE_PATH`

## Context

In production, the Admin Dashboard controls the host Docker daemon through
`/var/run/docker.sock`. Its upgrade flow runs Compose from inside the admin
container with:

```text
docker compose --env-file /opt/ai-engkit/.env \
  -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-dev
```

The production workspace is a host directory bind-mounted into ai-dev at
`/home/devuser/workspace`.

## Problem

Using a relative value such as `WORKSPACE_PATH=./workspace` is unsafe in this
DooD flow. Compose resolves relative paths from the directory of the first
Compose file passed with `-f`, which is `/opt/ai-engkit` in the admin
container. The host Docker daemon then receives a path rooted under
`/opt/ai-engkit`, not the intended production workspace.

This can recreate ai-dev with the wrong host directory mounted while commands
run directly from the host appear correct. OpenChamber then reports missing or
unresolvable projects even though the real project data remains intact.

## Solution

Set `WORKSPACE_PATH` to an absolute path on the Docker daemon host:

```dotenv
WORKSPACE_PATH=/home/jonathan/workspace
```

The maintained `.env.example` must not present `./workspace` as a safe example
for DooD deployments. Leaving `WORKSPACE_PATH` unset still selects the managed
Docker named volume and does not use a host bind path.

Do not delete a previously mis-mounted directory merely because it is no
longer mounted. Inventory and reconcile it first; it may contain sessions,
project files, backups, or credentials created while the wrong mount was live.

## Why It Works

An absolute source path is independent of the Compose file location. Both a
host-side Compose invocation and the Admin Dashboard's container-side
invocation send the same host path to the Docker daemon.

The admin upgrade's environment merge preserves existing values, so a valid
absolute `WORKSPACE_PATH` remains in `.env` across upgrades.

## Side Effects / Tradeoffs

- The absolute path is host-specific and must be configured separately on each
  deployment host.
- Moving the host workspace requires updating `.env` before recreating ai-dev.
- `--force-recreate` does not require changing this path and normally reuses
  mounted volumes; `--renew-anon-volumes` is a separate option.
- Cleanup of old workspace trees or detached volumes is a separate destructive
  task and requires an inventory, backup, owner, and rollback plan.

## Evidence

- Incident observed on 2026-08-08: the incorrect container had Compose working
  directory `/opt/ai-engkit` and workspace source
  `/opt/ai-engkit/workspace`.
- After setting `WORKSPACE_PATH=/home/jonathan/workspace` and recreating the
  stack, `docker inspect ai-engkit` reported:
  `bind /home/jonathan/workspace -> /home/devuser/workspace`.
- Post-fix validation: Admin Dashboard and OpenChamber health endpoints returned
  HTTP 200; all 26 registered OpenChamber project paths resolved inside ai-dev.
- The previously mis-mounted `/opt/ai-engkit/workspace` contained divergent
  session files. A separate `/home/devuser/workspace` tree contained projects,
  database backups, and credentials, confirming that neither path was safe to
  delete as an "empty shell."
- Docker Compose documents that relative paths use the first `-f` file as their
  base: <https://docs.docker.com/reference/cli/docker/compose/>.

## Related Files

- `.env.example` — absolute-path warning and example
- `docker-compose.yml` — `${WORKSPACE_PATH:-workspace}` workspace mount
- `src/admin/lib/upgrade.ts` — Admin Dashboard Compose invocation and env merge
- `src/admin/lib/env.ts` — `.env` value preservation
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — host-side
  bind-source resolution in DooD
- `docs/knowledge/troubleshooting/openchamber-projects-lost-after-upgrade.md` —
  project registration versus workspace data

## Tags

`dood` `docker-compose` `bind-mount` `workspace` `workspace-path` `admin-upgrade`
`absolute-path` `openchamber` `production`
