# Bun + Hono JSX Renders `[object Object]` When `working_dir` Is Missing

## Context

Admin dashboard in ai-engkit uses Hono JSX (`hono/jsx`) to render HTML views via `c.html()`. The admin server runs inside a Docker container via `docker compose`, started with `bun run /opt/admin/server.ts`. JSX configuration is in `/opt/admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  }
}
```

## Problem

All admin pages render as `[object Object]` (15 bytes). Every page — dashboard, projects, env editor, etc. — shows nothing but that text in the browser. No errors in container logs; health check passes (`200 OK`).

## Root Cause

Bun resolves `tsconfig.json` from the **current working directory (CWD)**, not from the script file's directory. In `docker-compose.yml`, the `ai-admin` service had no `working_dir` set:

```yaml
command: ["bun", "run", "/opt/admin/server.ts"]
```

Without `working_dir`, the container's default CWD is `/home/devuser/workspace` (from the Dockerfile). There is no `tsconfig.json` there. Bun therefore skips the JSX import source config and falls back to **React's JSX runtime** (`react/jsx-dev-runtime`), even though `react` is installed only as a Hono peer dependency.

The return value from a component transpiled with React's JSX is a React element (`{ $$typeof, type, props, key, ... }`). When Hono's `c.html()` receives this object, it stringifies it via `toString()`, producing `[object Object]`.

Detection — inside the container, the transpiled output shows React element shape:

```
{ $$typeof: Symbol(react.transitional.element), type, props, key, _owner, _store }
```

instead of Hono's `JSXNode`:

```
JSXNode { tag, props, children, toString: [Function], ... }
```

## Solution

Add `working_dir: /opt/admin` to the `ai-admin` service in `docker-compose.yml`:

```yaml
ai-admin:
  image: ghcr.io/tryweb/ai-engkit:latest
  container_name: ai-engkit-admin
  entrypoint: ["/usr/bin/tini", "--"]
  working_dir: /opt/admin
  command: ["bun", "run", "/opt/admin/server.ts"]
```

This ensures Bun finds `/opt/admin/tsconfig.json` and uses `hono/jsx/jsx-dev-runtime` (or `hono/jsx/jsx-runtime`) for JSX transformation.

## Why It Works

Bun's JSX transform checks `tsconfig.json` (or `jsconfig.json`) starting from the CWD, walking up the directory tree. When CWD is `/opt/admin`, it finds the tsconfig that specifies `"jsxImportSource": "hono/jsx"`. Bun then imports JSX helpers from `hono/jsx/jsx-dev-runtime` instead of `react/jsx-dev-runtime`, producing `JSXNode` objects that Hono's `c.html()` can render to HTML.

## Side Effects / Tradeoffs

- The dev compose (`docker-compose.dev.yml`) already had `working_dir: /opt/admin` — only production was missing it.
- If the tsconfig is in a parent directory, `working_dir` must be adjusted accordingly, or use an absolute symlink.
- Alternative: add `"bun": { "jsx": "...", "jsxImportSource": "..." }` to `package.json` in the project root, but that couples the admin config to the workspace root.

## Detection

From inside the admin container:

```bash
# Check if tsconfig is found
bun -e "
import { Layout } from '/opt/admin/views/layout';
const r = Layout({title:'t', children:'h', currentPath:'/'});
console.log(Object.keys(r));
# If output includes '$$typeof' → using React runtime (BROKEN)
# If output includes 'tag','props','children' → using Hono runtime (OK)
"
```

Or in the browser: open any admin page. If the entire page is literally `[object Object]`, this is likely the cause.

## Evidence

- Before fix: `curl http://admin:8380/` returned 15 bytes: `[object Object]`
- After fix: `curl http://admin:8380/` returned ~7,900 bytes of valid HTML
- All 8 admin sub-pages confirmed working with proper HTML content
- Container log showed no errors either way — health check always passed

## Related Files

- `docker-compose.yml` — added `working_dir: /opt/admin`
- `src/admin/tsconfig.json` — JSX config (was correct but unreachable)

## Tags

`bun` `hono` `jsx` `tsconfig` `working-directory` `docker-compose` `admin` `[object Object]`
