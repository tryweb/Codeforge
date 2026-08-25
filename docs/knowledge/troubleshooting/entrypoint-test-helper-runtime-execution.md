# Entrypoint Test Helpers Executed at Container Startup

## Context

The image copies `entrypoint.d/` to `/entrypoint.d/`. The runtime `entrypoint.sh` executes every regular file in that directory, and the Dockerfile marks every copied `*.sh` executable.

## Problem

A host-only regression test named `entrypoint.d/02-init-config.test.sh` was copied into the image. Every `ai-dev` and `ai-admin` startup therefore ran the test suite before launching the service.

The symptom was test-only output such as `AGENTS sync tests passed` and temporary malformed-config recovery messages in normal Compose startup logs.

## Solution

- Exclude `entrypoint.d/*.test.sh` in `.dockerignore`.
- Keep the test on the host so `test/run-tests.sh` can invoke it directly.
- Assert from the integration suite that `/entrypoint.d/02-init-config.test.sh` is absent in the runtime container.

## Why It Works

The test remains available to repository tooling but never enters the Docker build context. The runtime assertion catches future changes that accidentally package it again.

## Side Effects / Tradeoffs

- Entrypoint tests cannot be executed from inside the built image; they remain host-side tests against repository source.
- Any future runtime script that intentionally ends with `.test.sh` will also be excluded and should be renamed.

## Evidence

- Before the fix, image `sha256:2fe433f4...` contained the helper at mode 775 and the runtime assertion failed.
- Both dev service logs showed test-only output during startup.
- After rebuilding image `sha256:3f0f2e74...`, the same assertion passed and fresh logs contained no test-helper output.
- `bash test/run-tests.sh ai-engkit-dev` completed with 132 passed, 0 failed, and 0 skipped.

## Related Files

- `.dockerignore`
- `Dockerfile`
- `entrypoint.sh`
- `entrypoint.d/02-init-config.test.sh`
- `test/run-tests.sh`

## Tags

`docker`, `entrypoint`, `build-context`, `testing`, `compose`
