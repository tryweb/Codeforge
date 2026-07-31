# Compose Change Upgrade Impact Checklist

## Context

ai-engkit has **two independent upgrade paths** that must be checked separately whenever `docker-compose.yml` changes:

| Path | Runner | Recreates | Host-file bind mounts in compose |
|---|---|---|---|
| `upgrade.sh` | host shell (`curl \| bash` or `./upgrade.sh`) | **all services** (`docker compose up -d --force-recreate`) | resolved against the host install dir (script `cd`s there) |
| Admin UI upgrade (`src/admin/lib/upgrade.ts` `runUpgrade()`) | inside the `ai-admin` container via `/var/run/docker.sock` | **only `ai-dev`** (`up -d --force-recreate ai-dev`) | **not applied** — `ai-admin` is never recreated |

Adding a new **host-file bind mount** (e.g. `./provider-keys.json:/opt/ai-engkit/provider-keys.json:rw`) to a service therefore has different blast radius per path.

## Problem

A bind mount whose host source file does not exist is auto-created by the Docker daemon as a **directory** (not a file, not an error). A container that writes to that path then fails with `EISDIR` — but only on the first write, so the failure is **delayed and masked**:

- `healthcheck` passes (the admin server boots; reads of the directory return empty via catch).
- The upgrade looks successful.
- The first registry write (add/import/delete key) throws `EISDIR` → 500.

Which path triggers it:

- `upgrade.sh` recreates all services → `ai-admin` picks up the new mount immediately → risk fires on the very next upgrade, **unless** the script first creates the host file.
- Admin UI upgrade writes the new compose to the host (`writeFileSync(COMPOSE_FILE, latestCompose)` in `runUpgrade()`) but never recreates `ai-admin` → **no immediate failure**, but the new mount is now "armed" for the next `ai-admin` recreate from any source.

## Solution

Whenever a compose change adds a host-file bind mount, cover **all** paths that can recreate the mounting service:

1. **install.sh + upgrade.sh** — before `compose up`, ensure the file exists as a regular file, owned by the container user (admin runs as `devuser`, UID 1000):

```bash
ensure_provider_keys() {
    if [ -d provider-keys.json ]; then
        # Replace the directory Docker auto-created for the bind mount
        rm -rf provider-keys.json
    fi
    if [ ! -f provider-keys.json ]; then
        printf '{"providers":{}}\n' > provider-keys.json
        ok "provider-keys.json registry initialized"
    fi
    chown 1000:1000 provider-keys.json 2>/dev/null || true
    chmod 600 provider-keys.json
}
```

2. **entrypoint.d/00-fix-perms.sh** — add `fix_perms /opt/ai-engkit/<file>` so a host-root-created file gets chowned to devuser on container start (same pattern as `.env`).

3. **Write side (defense in depth)** — guard in the writer so a directory produces a clear error instead of `EISDIR`:

```ts
if (existsSync(KEYS_PATH) && !statSync(KEYS_PATH).isFile()) {
  throw new Error(`provider-keys.json is not a regular file: ${KEYS_PATH}`);
}
```

4. **Admin UI path** — no script change needed while `runUpgrade()` only recreates `ai-dev` (the mount lives on `ai-admin`). If a future change recreates `ai-admin`, add the same ensure step before the compose command in `runUpgrade()`.

## Why It Works

- The `[ -d ]` → `rm -rf` branch is safe: Docker auto-creates an **empty** directory, so no data is lost.
- `chown 1000:1000` matches the container's runtime user (`devuser`), avoiding the separate `EACCES` failure mode documented in `bindmount-env-ownership-admin-save.md`.
- The `isFile()` guard converts an opaque `EISDIR` into a diagnosable message, and is unreachable once scripts create the file — but protects any manual `docker compose up` that skipped them.

## Side Effects / Tradeoffs

- **Manual `docker compose up`** (not via upgrade.sh/install.sh) can still re-create the directory problem if the file is missing — no script can intercept arbitrary manual commands. The next `upgrade.sh` run self-heals (`[ -d ]` → replace with file).
- **Admin UI upgrades do not refresh the `ai-admin` container** (by design, see `upgrade-engine-sse-and-compose-pitfalls.md`): new admin code — including fixes like the `isFile()` guard — only takes effect on the next `ai-admin` recreate.
- The `rm -rf provider-keys.json` looks alarming next to a `.json` name; the comment exists because Docker's auto-create behavior is not visible in the code itself.

## Evidence

- Dev reproduction: bind-mounting a nonexistent host file path yields a **directory** inside the container (`cat` → `read error: Is a directory`) — documented in `dood-bindmount-admin-override.md`.
- `ensure_provider_keys()` logic tested standalone: dir→file, existing file preserved, idempotent re-run — all pass.
- Admin image rebuilt + `--force-recreate`; healthcheck OK; API smoke test (login → add key → delete key) all `{"ok":true}`; registry intact after cleanup.
- `bash -n` clean on `install.sh`, `upgrade.sh`, `entrypoint.d/00-fix-perms.sh`.
- `runUpgrade()` recreated `ai-dev` only: `compose -p <project> --env-file <env> -f <compose> up -d --force-recreate ai-dev`.

## Related Files

- `docker-compose.yml` — `./provider-keys.json:/opt/ai-engkit/provider-keys.json:rw` on `ai-admin`
- `install.sh` / `upgrade.sh` — `ensure_provider_keys()` in `prepare_volumes()`
- `entrypoint.d/00-fix-perms.sh` — `fix_perms /opt/ai-engkit/provider-keys.json`
- `src/admin/lib/provider-keys.ts` — `writeProviderKeys()` `isFile()` guard
- `src/admin/lib/upgrade.ts` — admin UI upgrade path (recreate ai-dev only)
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — root cause (DooD bind source resolution / auto-created dirs)
- `docs/knowledge/troubleshooting/bindmount-env-ownership-admin-save.md` — the ownership variant (EACCES)
- `docs/knowledge/troubleshooting/upgrade-engine-sse-and-compose-pitfalls.md` — why admin UI upgrade omits the ai-admin recreate

## Tags

`compose` `bind-mount` `upgrade` `docker` `install.sh` `EISDIR` `file-vs-directory` `permissions`
