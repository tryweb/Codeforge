# OpenChamber `/favicon.ico` NotFoundError

## Context

The dev stack runs OpenChamber 1.16.3 inside `ai-engkit-dev` with its web UI exposed on port 3000. Browsers may request `/favicon.ico` automatically even when the HTML explicitly links PNG and SVG favicons.

## Problem

The OpenChamber distribution contained `favicon.png`, `favicon-16.png`, `favicon-32.png`, and `favicon.svg`, but no `favicon.ico`. A direct request returned HTTP 404:

```text
GET /favicon.ico -> 404
```

The persisted OpenChamber log also contained a `NotFoundError: Not Found` stack from `send`/`serve-static` and `static-routes-runtime.js:51`. Because OpenChamber logs are stored in the `openchamber-data-dev` volume, old errors can be replayed after a container restart.

## Solution

`Dockerfile` now creates a valid ICO container around the shipped PNG during image build. The generated file is written to:

```text
/home/devuser/.bun/install/global/node_modules/@openchamber/web/dist/favicon.ico
```

`test/run-tests.sh` now checks these OpenChamber resources from inside the container:

- `/favicon.ico`
- `/favicon.svg`
- `/favicon-32.png`
- `/site.webmanifest`

The test also compares the `NotFoundError` count before and after the requests, so historical log entries do not cause false failures while newly generated errors are detected.

## Why It Works

The image build reads the existing PNG dimensions, writes an ICO header and directory entry, and embeds the PNG payload. Express therefore finds a real `/favicon.ico` file and responds with HTTP 200 and `Content-Type: image/vnd.microsoft.icon`.

The fix is image-local and does not modify the host filesystem, Docker socket, or OpenChamber configuration volume.

## Side Effects / Tradeoffs

- The ICO is generated during every image build only when the package does not already provide one.
- The generated ICO embeds the existing PNG, avoiding a separately maintained binary asset.
- Existing persisted log files may still contain historical errors; clear the OpenChamber log file or recreate the dev data volume when a clean log history is required.
- The OpenChamber package remains pinned at `1.16.3`; this is a compatibility workaround for the packaged asset set.

## Evidence

Validated with `docker-compose.dev.yml` after rebuilding `ai-engkit-ai-dev`:

- `/favicon.ico`: HTTP 200
- `/favicon.svg`: HTTP 200
- `/favicon-32.png`: HTTP 200
- `/site.webmanifest`: HTTP 200
- `docker logs --since 5m ai-engkit-dev`: zero `NotFoundError` entries
- Dev integration suite: `148 passed, 0 failed`
- Admin API suite: `7 passed, 0 failed`
- Admin UI suite: `15 passed, 0 failed`
- Both containers running with restart count `0`

## Related Files

- `Dockerfile`
- `test/run-tests.sh`
- `docker-compose.dev.yml`
- `entrypoint.sh`
- `docs/knowledge/tooling/openchamber-project-data-architecture.md`

## Tags

`openchamber` `favicon` `static-assets` `docker` `troubleshooting` `notfounderror`
