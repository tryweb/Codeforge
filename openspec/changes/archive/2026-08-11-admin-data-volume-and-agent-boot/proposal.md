## Why

Two related persistence defects surface on ai-admin container recreation (version update, manual restart, reboot):

1. **Agent Connection comes up disabled** — the boot path (`server.ts` → `startAgent()`) reads only `process.env`, which never contains `CENTER_URL` in the ai-admin container (compose has no `env_file` for ai-admin). The configuration lives in the bind-mounted `/opt/ai-engkit/.env`, which is only consulted by `reloadAgent()` (triggered by saving settings in the UI). Any restart wipes the in-memory runtime and nothing re-reads the env file.

2. **mTLS CA file is container-local** — `center-ca.pem` is written to the container filesystem, which is not mounted; it is lost on every recreate, silently breaking TLS on reconnect.

The admin container persists state across an arbitrary set of host bind mounts (`provider-state`, `.env`, `compose.yml`, `backups`) plus one container-local file. Consolidating the admin's own runtime state into a single `admin-data` directory gives future admin features a defined persistence home and fixes the CA-loss defect.

## What Changes

- **Add `./admin-data:/opt/ai-engkit/admin-data:rw` directory bind mount** to the `ai-admin` service; **remove the `./provider-state:` mount** (production and dev compose files).
- **Move `provider-keys.json`** from `/opt/ai-engkit/provider-state/provider-keys.json` to `/opt/ai-engkit/admin-data/provider-keys.json`.
- **Move the mTLS CA path** `CENTER_CA_PATH` from `/opt/ai-engkit/center-ca.pem` to `/opt/ai-engkit/admin-data/center-ca.pem`, so the CA file persists across recreates.
- **Migration in `install.sh` / `upgrade.sh` / dev compose init**: create `admin-data` and move any existing `provider-state/provider-keys.json` into it, preserving legacy files with a timestamped suffix (never delete). No CA migration is needed — no deployment has an actual CA file yet.
- **Agent boot fix**: `server.ts` boots the agent with the env file merged (`{ ...process.env, ...readEnvFile() }`), matching `reloadAgent()` semantics, so `CENTER_URL` (and token/CA vars) from `/opt/ai-engkit/.env` take effect immediately after any restart.
- **Pre-upgrade backup**: `runUpgrade()` additionally snapshots `provider-keys.json` alongside the existing `.env` / compose / OpenChamber settings backups.
- **`entrypoint.d/00-fix-perms.sh`**: `fix_perms` covers `/opt/ai-engkit/admin-data`.

No **BREAKING** changes: existing `CENTER_URL`/`CENTER_TOKEN` values in `.env` are untouched; the registry file moves, but the migration preserves data; `CENTER_CA_CERT` is not present in any deployment, so the path change is inert.

## Capabilities

### New Capabilities
- `admin-persistence`: The admin runtime persists its own state files (provider key registry, mTLS CA certificate, future additions) under the `admin-data` directory mount, which survives container recreation.

### Modified Capabilities
- `provider-api-key-registry`: registry persistence path changes from `provider-state/provider-keys.json` to `admin-data/provider-keys.json`.
- `agent-connect`: `CENTER_URL` configuration is resolved from the admin env file at startup (not only the process environment), so the agent re-enables itself after any restart without a UI save.

## Impact

- **Compose**: `docker-compose.yml`, `docker-compose.dev.yml` (ai-admin mounts; dev init command)
- **Admin code**: `src/admin/lib/provider-keys.ts` (`KEYS_PATH`), `src/admin/routes/agent.ts` (`CENTER_CA_PATH`), `src/admin/server.ts` (agent boot), `src/admin/lib/upgrade.ts` (backup snapshot)
- **Shell**: `install.sh`, `upgrade.sh` (`ensure_provider_state()`), `entrypoint.d/00-fix-perms.sh`
- **Tests**: `src/admin/routes/agent.test.ts` (CA path assertion); provider tests are path-override driven (`PROVIDER_KEYS_PATH`) and unaffected
- **Docs**: `README.md` provider-state references; `docs/knowledge/patterns/compose-change-upgrade-checklist.md`
