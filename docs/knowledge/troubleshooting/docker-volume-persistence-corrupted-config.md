# Docker Named Volume Persists Corrupted Config

## Context

ai-engkit uses Docker named volumes to persist configuration across container restarts. The `lean-ctx-config-dev` volume mounts at `/home/devuser/.config/lean-ctx` inside the ai-dev container. When the Dockerfile builds, it seeds the config directory; Docker copies image content to the volume on first run.

## Problem

When a config file inside a named volume becomes corrupted (e.g., invalid TOML), the corruption persists across:
- Container restarts (`docker compose restart`)
- Container recreation (`docker compose up -d`)
- Even `docker compose down` + `docker compose up -d`

The volume retains its content regardless of container state. The only way to restore the Dockerfile defaults is to **remove the volume entirely**.

## Solution

```bash
# Stop the container
docker compose -p dev -f docker-compose.dev.yml stop ai-dev

# Remove the corrupted volume
docker volume rm ai-engkit_lean-ctx-config-dev

# Restart — Docker copies image content to the new volume
docker compose -p dev -f docker-compose.dev.yml up -d ai-dev
```

## Why It Works

Docker named volumes follow copy-on-write semantics:
1. On first mount, Docker copies image directory content into the volume
2. Subsequent writes go to the volume, not the image
3. Volume content persists independently of container lifecycle
4. Only `docker volume rm` destroys the volume data

## Side Effects / Tradeoffs

- **All manual config changes are lost** when the volume is removed. Any custom `lean-ctx config set` values, shell hooks, or other modifications will revert to Dockerfile defaults.
- **Other named volumes are unaffected** — only the targeted volume is removed.
- **Container must be stopped first** — removing a volume while a container is using it causes errors.

## Detection

Symptoms of corrupted config in a volume:
- `lean-ctx config validate` fails with parse errors
- `lean-ctx doctor` reports config parse errors
- Admin API returns empty config (`{}`) despite file existing
- Config file content doesn't change after writes via `docker exec`

## Evidence

- Observed during LeanCTX feature development: `config.toml` had TOML parse error at line 6, column 9 (`"gh",` — invalid bare value)
- Multiple write attempts via `docker exec` and admin API returned success but file content unchanged
- Volume removal + container restart restored correct config from Dockerfile
- Verified: `docker volume rm ai-engkit_lean-ctx-config-dev` → `docker compose up -d` → config matches Dockerfile

## Related Files

- `docker-compose.dev.yml` — volume declaration for `lean-ctx-config-dev`
- `Dockerfile` L144-157 — config.toml seed content
- `docs/knowledge/tooling/lean-ctx-optimization.md` — lean-ctx config optimization (互补)

## Tags

`docker` `volume` `persistence` `config` `corruption` `troubleshooting`
