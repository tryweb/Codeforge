# Environment-Aware Sibling Container Targeting via /etc/hostname

## Context

Two environments (prod + dev) run concurrently on the same Docker host, each
with an admin container and a dev container:

```
ai-engkit           (prod dev)
ai-engkit-admin     (prod admin)
ai-engkit-dev       (dev dev)
ai-engkit-admin-dev (dev admin)
```

The admin container needs to find its sibling dev container (e.g.
`ai-engkit-admin-dev` → `ai-engkit-dev`) to run health checks and collect data.
The admin container also needs to know whether it's running in prod or dev to
conditionally disable features like Upgrade.

## Problem

The original `getAiDevContainerRef()` searched with `docker ps --filter name=ai-engkit` — a
substring match. In a multi-environment host this returns **all** containers
containing "ai-engkit" in their name (dev, admin, admin-dev, etc.), and the
first result is often the wrong environment.

The Docker-in-Docker (DooD) pattern means `hostname` inside the container is
the container's own ID, not the host's hostname. This ID can be used with
`docker inspect` to discover the container's own name.

A separate but related problem: the Upgrade page was visible even when
the container was built from a local dev image (`AI_ENGKIT_VERSION=dev`).
The backend API had guards, but the frontend still rendered the upgrade button.

## Solution

### 1. Self-ref container targeting (`src/admin/lib/docker.ts`)

```typescript
import { readFileSync } from "fs";

// Read own container ID from /etc/hostname (DooD: this is the container ID)
export async function getSelfContainerRef(): Promise<string> {
  return readFileSync("/etc/hostname", "utf-8").trim();
}

// Get own container name via docker inspect
export async function getOwnContainerName(): Promise<string> {
  const ref = await getSelfContainerRef();
  const { stdout } = await dockerCommand(
    `inspect --format='{{.Name}}' ${ref}`,
    10_000,
  );
  return stdout.trim().replace(/^\//, ""); // strip leading /
}

// Derive sibling dev container name by stripping -admin suffix
export async function getSiblingDevContainerName(): Promise<string> {
  const ownName = await getOwnContainerName();
  if (ownName.endsWith("-admin-dev")) {
    return ownName.replace(/-admin-dev$/, "-dev");
  }
  if (ownName.endsWith("-admin")) {
    return ownName.replace(/-admin$/, "");
  }
  throw new Error(`Unknown container name pattern: ${ownName}`);
}

// Find sibling dev container by exact name match
export async function getAiDevContainerRef(): Promise<string> {
  const containerName = await getSiblingDevContainerName();
  const { stdout } = await dockerCommand(
    `ps --filter "name=^/${containerName}$" --format "{{.ID}}"`,
    10_000,
  );
  return stdout.trim().split("\n")[0] || containerName;
}
```

Key techniques:
- `/etc/hostname` → container ID (works in all Docker contexts)
- `docker inspect --format='{{.Name}}'` → own container name
- Strip `-admin` suffix → derive sibling dev container name
- `name=^/exactname$` prevents substring collisions

### 2. Dev build guard for upgrade UI (`src/admin/routes/upgrade.ts` + `src/admin/views/upgrade.tsx`)

```typescript
// At module level in upgrade.ts (read once at startup)
const VERSION = (() => {
  try { return readFileSync("/opt/ai-engkit/VERSION", "utf-8").trim(); } catch { return "unknown"; }
})();

// In route handler — pass to template
upgrade.get("/upgrade", (c) => {
  return c.html(UpgradePage({ devBuild: VERSION === "dev" }));
});
```

Template (`upgrade.tsx`) conditionally renders explanation card instead of button:

```tsx
{devBuild ? (
  <div class="card" style="border-color:var(--accent);">
    <h3>Not Available in Dev Build</h3>
    <p>This environment is a locally-built dev image. Upgrade only
       available for production releases pulled from ghcr.io.</p>
  </div>
) : (
  // normal upgrade button + progress UI
)}
```

## Why It Works

- `/etc/hostname` is set by Docker to the container ID — it's always available
  and always correct, regardless of how the container was started (compose,
  docker run, swarm, etc.).
- `docker inspect` on self is always possible (no permission issue).
- The `-admin` / `-admin-dev` suffix convention is enforced by the compose
  files — if it changes, the stripping logic is a single centralized change.
- Exact `name=^/...$` match prevents the substring collision that was the
  original bug.
- Reading VERSION at module load time means it's evaluated once per server
  start and cannot change mid-lifecycle.

## Side Effects / Tradeoffs

- **Brittle name convention**: If the container naming pattern diverges from
  `{base}-admin` / `{base}-admin-dev`, the stripping logic breaks.
- **VERSION read at import time**: If the file doesn't exist at startup,
  defaults to "unknown" — the upgrade page will show the normal button (but
  backend will block execution since it won't match "dev").
- **Only works in Docker**: `/etc/hostname` is a Docker-injected file. In
  non-Docker environments the `readFileSync` will throw.

## Evidence

- Container `ai-engkit-admin-dev` reads `/etc/hostname` → returns its own
  container ID (e.g. `abc123def456`).
- `docker inspect abc123def456 --format '{{.Name}}'` → `/ai-engkit-admin-dev`.
- Stripping `-admin-dev` yields `ai-engkit-dev` — the correct sibling.
- `docker ps --filter name=^/ai-engkit-dev$` returns exactly 1 container.
- VERSION file contains "dev" for local builds, semantic version for releases.
- `/upgrade` renders the info card when VERSION=dev, button otherwise.
- Build succeeds with `bun build --no-bundle server.ts`.

## Related Files

- `src/admin/lib/docker.ts` — `getSelfContainerRef`, `getOwnContainerName`,
  `getSiblingDevContainerName`, `getAiDevContainerRef`
- `src/admin/routes/upgrade.ts` — VERSION read + devBuild flag
- `src/admin/views/upgrade.tsx` — conditional render based on `devBuild`
- `src/admin/routes/versions.ts` — `getUpdateCheck()` + `getLocalDigest()`
  also use `getSelfContainerRef()`
- `src/admin/lib/upgrade.ts` — `runUpgrade()` throws on VERSION=dev
- `docker-compose.dev.yml` — container name conventions
- `docker-compose.yml` — container name conventions
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — DooD context
- `docs/knowledge/patterns/docker-digest-update-check.md` — related update check

## Tags

`container-detection`, `environment-awareness`, `self-ref`, `docker-inspect`,
`hostname`, `dev-guard`, `upgrade-gate`, `multi-environment`, `dood`
