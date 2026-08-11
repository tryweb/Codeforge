# Compose Change Upgrade Impact Checklist

## Context

ai-engkit has **two independent upgrade paths** that must be checked separately whenever `docker-compose.yml` changes:

| Path | Runner | Recreates | Host-file bind mounts in compose |
|---|---|---|---|
| `upgrade.sh` | host shell (`curl \| bash` or `./upgrade.sh`) | **all services** (`docker compose up -d --force-recreate`) | resolved against the host install dir (script `cd`s there) |
| Admin UI upgrade (`src/admin/lib/upgrade.ts` `runUpgrade()`) | inside the `ai-admin` container via `/var/run/docker.sock` | **only `ai-dev`** (`up -d --force-recreate ai-dev`) | **not applied** — `ai-admin` is never recreated |

Adding a new **directory bind mount** (e.g. `./admin-data:/opt/ai-engkit/admin-data:rw`) to a service therefore has different blast radius per path.

## Problem

A bind mount whose host source directory does not exist is auto-created by the Docker daemon. The provider registry uses a directory mount because its writer persists through a temp file followed by `renameSync()`; a single-file bind mount cannot be replaced by `rename()` and fails with `EBUSY`.

- `healthcheck` passes because the admin server boots.
- The upgrade looks successful.
- The first registry write (add/import/delete key) throws `EBUSY` on a single-file bind mount → 500.

Which path triggers it:

- `upgrade.sh` recreates all services → `ai-admin` picks up the new mount immediately → risk fires on the very next upgrade, **unless** the script first creates the host file.
- Admin UI upgrade writes the new compose to the host (`writeFileSync(COMPOSE_FILE, latestCompose)` in `runUpgrade()`) but never recreates `ai-admin` → **no immediate failure**, but the new mount is now "armed" for the next `ai-admin` recreate from any source.

## Solution

Whenever a compose change adds a host-file bind mount, cover **all** paths that can recreate the mounting service:

1. **install.sh + upgrade.sh** — before `compose up`, ensure the state directory and file exist, preserve any legacy file or directory, and set ownership for `devuser` (UID 1000):

```bash
ensure_provider_state() {
    mkdir -p admin-data
    if [ -d provider-state/provider-keys.json ]; then
        mv provider-state/provider-keys.json provider-state/provider-keys.json.legacy.<timestamp>
    fi
    if [ -f provider-state/provider-keys.json ] && [ ! -e admin-data/provider-keys.json ]; then
        mv provider-state/provider-keys.json admin-data/provider-keys.json
    fi
    if [ -f provider-keys.json ] && [ ! -e admin-data/provider-keys.json ]; then
        mv provider-keys.json admin-data/provider-keys.json
    elif [ -d provider-keys.json ]; then
        mv provider-keys.json provider-keys.json.legacy.<timestamp>
    fi
    if [ ! -f admin-data/provider-keys.json ]; then
        printf '{"providers":{}}\n' > admin-data/provider-keys.json
    fi
    chown 1000:1000 admin-data admin-data/provider-keys.json 2>/dev/null || true
    chmod 700 admin-data
    chmod 600 admin-data/provider-keys.json
}
```

2. **entrypoint.d/00-fix-perms.sh** — use `fix_perms /opt/ai-engkit/admin-data` so the mounted directory and its file are writable by `devuser`.

3. **Write side** — retain temp-file plus rename, with `KEYS_PATH` set to `/opt/ai-engkit/admin-data/provider-keys.json`; the rename now occurs inside the directory mount.

4. **Admin UI path** — no script change needed while `runUpgrade()` only recreates `ai-dev` (the mount lives on `ai-admin`). If a future change recreates `ai-admin`, add the same ensure step before the compose command in `runUpgrade()`.

## Why It Works

- Existing legacy state is moved into the new directory or preserved with a timestamped legacy name; it is not deleted by the migration.
- `chown 1000:1000` matches the container's runtime user (`devuser`), avoiding the separate `EACCES` failure mode documented in `bindmount-env-ownership-admin-save.md`.
- Temp-file plus rename remains atomic because both paths are inside the directory mount.

## Side Effects / Tradeoffs

- **Manual `docker compose up`** (not via upgrade.sh/install.sh) can still omit the state file; the admin treats a missing registry as empty until the directory is initialized.
- **Admin UI upgrades do not refresh the `ai-admin` container** (by design, see `upgrade-engine-sse-and-compose-pitfalls.md`): new admin code — including fixes like the `isFile()` guard — only takes effect on the next `ai-admin` recreate.
- The migration deliberately preserves legacy paths because they may contain credentials.

## Evidence

- Dev reproduction: a single-file bind mount cannot be atomically replaced by `rename()` and returns `EBUSY`.
- `ensure_provider_state()` logic tested standalone: legacy file migration, missing state initialization, and idempotent re-run.
- Admin image rebuilt + `--force-recreate`; healthcheck OK; API smoke test (login → add key → delete key) all `{"ok":true}`; registry intact after cleanup.
- `bash -n` clean on `install.sh`, `upgrade.sh`, `entrypoint.d/00-fix-perms.sh`.
- `runUpgrade()` recreated `ai-dev` only: `compose -p <project> --env-file <env> -f <compose> up -d --force-recreate ai-dev`.

## Related Files

- `docker-compose.yml` — `./admin-data:/opt/ai-engkit/admin-data:rw` on `ai-admin`
- `install.sh` / `upgrade.sh` — `ensure_provider_state()` in `prepare_volumes()`
- `entrypoint.d/00-fix-perms.sh` — `fix_perms /opt/ai-engkit/admin-data`
- `src/admin/lib/provider-keys.ts` — `KEYS_PATH` under the admin-data directory
- `src/admin/lib/upgrade.ts` — admin UI upgrade path (recreate ai-dev only)
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — root cause (DooD bind source resolution / auto-created dirs)
- `docs/knowledge/troubleshooting/bindmount-env-ownership-admin-save.md` — the ownership variant (EACCES)
- `docs/knowledge/troubleshooting/upgrade-engine-sse-and-compose-pitfalls.md` — why admin UI upgrade omits the ai-admin recreate

## Tags

`compose` `bind-mount` `upgrade` `docker` `install.sh` `EBUSY` `directory-state` `permissions`
