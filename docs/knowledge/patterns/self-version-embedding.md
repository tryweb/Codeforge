# AI-EngKit Self-Version Embedding

## Context

AI-EngKit needs to display its own version on the admin dashboard Versions
page. The version is the Docker image tag (e.g., `v1.2.3`), set during CI/CD
by the `release` skill or `auto-tag` workflow. The version must be available at
runtime inside the container, matching the image tag exactly.

The admin server (`src/admin/`) runs inside the same Docker image and serves a
versions page showing all component versions (OpenCode, Docker, Playwright,
etc.). There was no mechanism for the image to report its own version.

## Problem

Git tag → image tag (e.g., `v1.2.3`) is assigned after the Docker image is
built in CI. The image doesn't know its own tag at build time because:

1. **Tag-push builds**: `github.ref_name` is the tag name — available at CI
   runtime, but needs to be baked into the image.
2. **auto-tag builds**: The tag is calculated (patch bump) **after** tests
   pass and the image is already built and cached. The image never saw the tag.
3. **Dev builds**: No tag exists; should show `dev`.

## Solution

Two-layer strategy covering all three scenarios:

### Layer 1: Build ARG + VERSION file (always present)

Dockerfile:
```dockerfile
ARG AI_ENGKIT_VERSION=dev
RUN mkdir -p /opt/ai-engkit && echo "$AI_ENGKIT_VERSION" > /opt/ai-engkit/VERSION
```

Admin API reads the file at runtime:
```typescript
import { readFileSync } from "fs";

async function getAiEngkitVersion(): Promise<string> {
  try {
    return readFileSync("/opt/ai-engkit/VERSION", "utf-8").trim();
  } catch {
    return "dev";
  }
}
```

### Layer 2: CI injection for post-build tag assignment

For `auto-tag` where the tag is created after the build, inject the version
into the already-built image using `docker commit`:

```yaml
# ci.yml — auto-tag job
- name: Inject version into image
  run: |
    VERSION="${{ steps.version.outputs.next-version }}"
    printf '%s' "${VERSION}" > /tmp/ai-engkit-version
    docker create --name tmp ai-engkit:ci
    docker cp /tmp/ai-engkit-version tmp:/opt/ai-engkit/VERSION
    docker commit tmp ai-engkit:ci > /dev/null
    docker rm -f tmp > /dev/null
```

For tag-push builds (`refs/tags/v*`), pass the tag as build-arg directly:

```yaml
# ci.yml — push job
- name: Tag and push
  run: |
    IMAGE="${{ env.REGISTRY }}/${GITHUB_REPOSITORY,,}"
    docker tag ai-engkit:ci "${IMAGE}:${{ github.ref_name }}"
```

### Layer 3: Dev compose default

`docker-compose.dev.yml` passes `AI_ENGKIT_VERSION=dev` as build-arg, so dev
builds always show `dev` as the version.

## Why It Works

- **Single source of truth**: The VERSION file at `/opt/ai-engkit/VERSION` is
  the sole runtime source for image version. It's created either at build time
  (ARG) or injected via CI (docker commit).
- **`readFileSync` is independent**: Unlike the docker/inspect-based metadata
  (image/digest/created), reading the VERSION file doesn't depend on Docker
  socket access, container naming, or compose file availability.
- **`docker commit` injection**: Adding a new layer with the VERSION file
  avoids rebuilding the image, which would invalidate cached test/scan
  results. The new layer only adds ~100 bytes.
- **Graceful fallback**: `getAiEngkitVersion()` returns `"dev"` on any error,
  so even if the file is missing, the page doesn't break.

## Side Effects / Tradeoffs

- **docker commit creates a new image digest**: The injected image has a
  different digest than the one that was tested/scanned. The difference is
  only a single text file layer (~100 bytes), so functional equivalence is
  preserved.
- **auto-tag flow**: The build-arg during the build step uses `git describe
  --tags --always`, which gives a descriptive string like `v0.0.5-3-gabc123`
  (previous tag + commits). This is overwritten by the docker commit injection
  in the auto-tag job with the exact new tag.
- **Dev builds**: `docker-compose.dev.yml` passes `AI_ENGKIT_VERSION=dev`.
  The value can be changed per-build: `docker compose build --build-arg
  AI_ENGKIT_VERSION=my-test-version`.

## Evidence

```bash
# Build with dev version
$ docker compose -f docker-compose.dev.yml build ai-admin
# Start container
$ docker compose -f docker-compose.dev.yml up -d ai-admin
# Verify VERSION file
$ docker exec ai-engkit-admin-dev cat /opt/ai-engkit/VERSION
dev
# API returns version
$ curl -s http://localhost:8081/api/versions/image
{"image":"...","digest":"...","created":"...","version":"dev"}
# Page renders Version row
<tr><td>Version</td><td><code>dev</code></td></tr>
```

## Related Files

- `Dockerfile` — `ARG AI_ENGKIT_VERSION=dev` + RUN to write VERSION file
- `.github/workflows/ci.yml` — `build` job passes `git describe` as ARG;
  `push` and `auto-tag` jobs inject version via docker commit
- `src/admin/routes/versions.ts` — `getAiEngkitVersion()` + `/api/versions/image`
- `src/admin/views/versions.tsx` — `imageMetaLabels` mapping with "Version" label
- `docker-compose.dev.yml` — `AI_ENGKIT_VERSION=dev` build arg for dev
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — DooD
  bind mount workaround (admin container needs docker socket access)

## Tags

- versioning
- ci-cd
- dockerfile
- docker-commit
- admin-dashboard
- build-arg
- self-version
