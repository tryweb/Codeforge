## Context

- ai-admin currently persists state across four host bind mounts (`./.env`, `./docker-compose.yml`, `./provider-state`, `./backups`) plus one **container-local** file (`/opt/ai-engkit/center-ca.pem`) that is lost on recreate.
- Dev mode already mounts the whole `/opt/ai-engkit` from the `admin-data-dev` named volume; production and dev layouts differ.
- The registry writer (`provider-keys.ts`) uses temp-file + `renameSync()` for atomicity — a **single-file** bind mount cannot be replaced by `rename()` (`EBUSY`), so a **directory** mount is mandatory (documented in `docs/knowledge/patterns/compose-change-upgrade-checklist.md`).
- Compose changes have two upgrade paths with different blast radius (checklist doc): `upgrade.sh` recreates all services; admin UI `runUpgrade()` recreates only `ai-dev`.
- The agent boot path (`server.ts` → `startAgent()`) reads only `process.env`; `reloadAgent()` already implements the correct `{...process.env, ...readEnvFile()}` merge.

## Goals / Non-Goals

**Goals:**
- Single, documented persistence home (`/opt/ai-engkit/admin-data`) for admin runtime state: provider registry + mTLS CA + future files.
- Registry and CA file survive admin container recreation.
- Agent re-enables itself from the env file after any restart, without a UI save.
- Upgrade paths (`install.sh`, `upgrade.sh`, dev init) migrate the existing `provider-state/provider-keys.json` into `admin-data` with legacy preservation.

**Non-Goals:**
- Moving `.env`, `compose.yml`, or `backups` into `admin-data` — each has a distinct consumer (host compose interpolation, upgrade flow, retention pruning) that assumes its current host path.
- Full alignment with dev's single-mount layout (`./admin-data:/opt/ai-engkit`) — would relocate `.env`/`compose.yml` host paths and break install/upgrade assumptions.
- CA file migration — no deployment has an actual `center-ca.pem` yet; the path change is inert until the next save.

## Decisions

### D1: `admin-data` as a dedicated directory bind mount

`./admin-data:/opt/ai-engkit/admin-data:rw` on `ai-admin` (production), replacing the `./provider-state` mount. Dev keeps its named volume but gains an `admin-data` subdirectory under it.

- **Why directory, not single-file**: registry writes use temp-file + `renameSync()`; atomic rename requires both paths inside a directory mount (EBUSY on single-file bind mounts).
- **Why not collapse all mounts**: `.env` is read by host compose interpolation and install/upgrade scripts; `compose.yml` is rewritten by `runUpgrade()`; `backups` is pruned by retention policy. Mixing them into `admin-data` couples unrelated lifecycles.

### D2: Path changes

| Constant | Before | After |
|---|---|---|
| `KEYS_PATH` (provider-keys.ts) | `/opt/ai-engkit/provider-state/provider-keys.json` | `/opt/ai-engkit/admin-data/provider-keys.json` |
| `CENTER_CA_PATH` (routes/agent.ts) | `/opt/ai-engkit/center-ca.pem` | `/opt/ai-engkit/admin-data/center-ca.pem` |

- `PROVIDER_KEYS_PATH` env override stays — CI and tests are unaffected.
- `CENTER_CA_CERT` written by `applyAgentConfig` will point at the new path on the next save; no `.env` rewrite is performed (no deployed CA file exists).

### D3: Boot-time env merge in `server.ts`

Boot calls `startAgent({ env: { ...process.env, ...readEnvFile() } })` instead of `startAgent()`, reusing `reloadAgent()`'s merge semantics. Env-file values win over process env, matching the UI-save behavior.

- Alternative considered: adding `env_file: .env` to the ai-admin compose service. Rejected — it changes container env for every variable (broader surface) and does not fix already-deployed containers that never recreate with the new compose.

### D4: Migration in shell paths (legacy-preserving)

`ensure_provider_state()` in `install.sh` / `upgrade.sh` (and the dev compose init command) is reworked:

1. `mkdir -p admin-data`
2. If `provider-state/provider-keys.json` exists and `admin-data/provider-keys.json` does not → `mv` (preserve via timestamped `.legacy.<ts>` suffix on conflict)
3. Initialize `admin-data/provider-keys.json` with `{"providers":{}}` if absent
4. `chown 1000:1000` + `chmod 700` dir, `600` file
5. `fix_perms /opt/ai-engkit/admin-data` in `entrypoint.d/00-fix-perms.sh`

Per the checklist doc, the admin UI upgrade path needs no script change (it never recreates ai-admin); the new mount arms only on the next ai-admin recreate.

### D5: Pre-upgrade backup includes the registry

`runUpgrade()` Step 2 additionally copies `admin-data/provider-keys.json` into the pre-upgrade backup directory (best-effort, non-fatal on absence), alongside `.env`, compose, and OpenChamber settings.

## Risks / Trade-offs

- **Admin UI upgrades arm the new mount without applying it** — by design (`runUpgrade` recreates only ai-dev); the registry keeps working via the old `provider-state` path until the next admin recreate, then migrates via the next host-side upgrade. Mitigation: both paths preserve legacy data; nothing is deleted.
- **Registry path constant change vs deployed `.env`**: no `.env` key references the registry path (it is internal); `CENTER_CA_CERT` references only the CA path, which has no deployed value yet.
- **Manual `docker compose up` without migration** (bypassing install/upgrade scripts) would boot with an empty `admin-data` registry while `provider-state/provider-keys.json` still exists on the host. The file is not deleted by any path, so recovery is a manual `mv` or next scripted upgrade.
- **Dev compose command length** grows with the migration block; kept as shell for parity with the existing init command.
