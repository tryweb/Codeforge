## 1. Admin-data volume (compose + code)

- [x] 1.1 `docker-compose.yml`: replace `./provider-state:/opt/ai-engkit/provider-state:rw` with `./admin-data:/opt/ai-engkit/admin-data:rw` on `ai-admin`
- [x] 1.2 `src/admin/lib/provider-keys.ts`: change `KEYS_PATH` to `/opt/ai-engkit/admin-data/provider-keys.json`
- [x] 1.3 `src/admin/routes/agent.ts`: change `CENTER_CA_PATH` to `/opt/ai-engkit/admin-data/center-ca.pem`
- [x] 1.4 `src/admin/routes/agent.test.ts`: update the `CENTER_CA_CERT` assertion to the new path

## 2. Upgrade-path migration (shell + dev)

- [x] 2.1 `install.sh`: rework `ensure_provider_state()` to build `admin-data` and move an existing `provider-state/provider-keys.json` into it (legacy-preserving)
- [x] 2.2 `upgrade.sh`: same rework as 2.1
- [x] 2.3 `docker-compose.dev.yml`: dev init command creates `/opt/ai-engkit/admin-data` and migrates `provider-state` there; keep the `admin-data-dev` named volume
- [x] 2.4 `entrypoint.d/00-fix-perms.sh`: add `fix_perms /opt/ai-engkit/admin-data`

## 3. Agent boot fix + backup hardening

- [x] 3.1 `src/admin/server.ts`: boot the agent with `{ env: { ...process.env, ...readEnvFile() } }` instead of `startAgent()`
- [x] 3.2 `src/admin/lib/upgrade.ts`: pre-upgrade backup step also snapshots `admin-data/provider-keys.json` (best-effort)

## 4. Docs + verification

- [x] 4.1 `README.md`: update provider-state path references to admin-data
- [x] 4.2 `docs/knowledge/patterns/compose-change-upgrade-checklist.md`: update the mount/`KEYS_PATH`/`fix_perms` references
- [x] 4.3 Run the admin test suite (`bun test src/admin`), `bash -n` on `install.sh`/`upgrade.sh`/`00-fix-perms.sh`, and `openspec validate` — all green
