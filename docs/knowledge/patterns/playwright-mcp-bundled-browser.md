# Playwright MCP — Bundled Browser Wrapper

## Context

ai-engkit ships `@playwright/mcp` so AI agents can drive a real browser. The
Docker image is built on Ubuntu 24.04 and **has no system Google Chrome**
installed — only Playwright's bundled Chromium under `/ms-playwright/`. When
the MCP server starts, it must locate a browser executable.

This applies to any Docker-based image that wants to expose Playwright MCP
without shipping the full Google Chrome distribution.

## Problem

`@playwright/mcp`'s `--browser` flag accepts channel names only:

| Value | Resolves to |
|-------|-------------|
| `chrome` | System Google Chrome (default — looks for `/opt/google/chrome/chrome` and similar) |
| `msedge` | System Microsoft Edge |
| `firefox` / `webkit` | Playwright-bundled Firefox / WebKit |

The value `chromium` is **not** a valid `--browser` argument. With no flag, the
server defaults to `chrome` and tries to launch system Chrome. On this image
it fails with:

```
browserType.launch: Executable doesn't exist at /opt/google/chrome/chrome
```

There is a second, separate failure mode: installing the browser during the
image build does not install the `playwright` or `@playwright/mcp` CLI binaries
for runtime. A runtime `bunx -y` call can therefore hit the package registry,
hang when DNS is unavailable, or make a fresh container behave differently
from a warmed cache.

Earlier attempts (e.g. `playwright install --only-shell chromium` to slim the
image) made things worse: the headless shell is not what the MCP's
new-headless mode launches — it expects the full Chromium binary.

## Solution

Add a wrapper script `/usr/local/bin/pw-mcp` that:

1. Resolves the actual bundled Chromium path at runtime under
   `/ms-playwright/chromium-<revision>/chrome-linux64/chrome` (the revision
   directory changes with every Playwright release).
2. Falls back to the headless shell if the full build is absent.
3. Launches the globally installed `playwright-mcp` binary with
   `--executable-path=<path> --no-sandbox --headless`.

The Dockerfile installs the pinned CLI packages globally with Bun:

```dockerfile
RUN bun install -g playwright@${PLAYWRIGHT_VERSION} \
    @playwright/mcp@${PLAYWRIGHT_MCP_VERSION}
```

Bun exposes their binaries under `/home/devuser/.bun/bin`, which is already on
the image `PATH`.

Wire it into `opencode.json` (both baked default and runtime regenerator):

```json
"playwright": {
  "type": "local",
  "command": ["pw-mcp"],
  "enabled": true
}
```

The wrapper script (core shape — full version in repo):

```bash
#!/usr/bin/env bash
set -euo pipefail
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

CHROME_BIN="$(find "${PLAYWRIGHT_BROWSERS_PATH}" \
    -type f -name chrome -path '*/chromium-*/chrome-linux64/*' 2>/dev/null | sort -V | tail -1)"

if [ -z "${CHROME_BIN}" ]; then
    CHROME_BIN="$(find "${PLAYWRIGHT_BROWSERS_PATH}" \
        -type f -name chrome-headless-shell -path '*/chromium_headless_shell-*/chrome-headless-shell-linux64/*' 2>/dev/null | sort -V | tail -1)"
fi

exec playwright-mcp \
    --executable-path="${CHROME_BIN}" --no-sandbox --headless "$@"
```

## Why It Works

- **`--executable-path` overrides `--browser`**: The MCP's documented flag
  precedence is: explicit executable path > browser channel. Passing it
  sidesteps the system-Chrome lookup entirely.
- **Runtime resolution handles version drift**: Playwright bumps the
  `chromium-<revision>` suffix on every release. Hardcoding a path like
  `/ms-playwright/chromium-1228/...` breaks the next `playwright install`.
  Using `find` with a glob pattern (`chromium-*/chrome-linux64/chrome`)
  always finds whatever's there.
- **Global install removes runtime registry dependency**: The image installs
  `playwright@${PLAYWRIGHT_VERSION}` and
  `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}` during build, and runtime calls
  their binaries directly instead of invoking `bunx -y`.
- **Headless + `--no-sandbox`** are required: the Docker image has no
  X server and no namespace to drop into. Both are safe for the dev /
  automation use case the MCP targets.

## Side Effects / Tradeoffs

- **Image size**: Full Chromium is ~280 MB. The previous `--only-shell`
  attempt was ~114 MB but incompatible with the MCP's new-headless mode.
  Keep the full build and pay the disk cost. (Acceptable for a dev
  image; revisit if shipping as a production runtime.)
- **Indirection**: An extra `exec` layer between OpenCode and the MCP
  process. Harmless — exit codes and signals propagate. The only visible
  effect is `pgrep` shows `pw-mcp` rather than the underlying `node` child.
- **Playwright CLI ≠ MCP binary**: The Playwright CLI test (e.g.
  `playwright --version`) and the bundled browser work without the wrapper.
  The wrapper is only needed for the MCP server's `chrome` channel default.

## Evidence

- Build verification: `playwright` resolves to
  `/home/devuser/.bun/bin/playwright` and reports `Version 1.62.1`.
- Build verification: `playwright-mcp` resolves to
  `/home/devuser/.bun/bin/playwright-mcp` and reports `Version 0.0.79`.
- Main container integration suite: `128 passed, 0 failed, 0 skipped`.
- MCP smoke test: JSON-RPC `browser_navigate` succeeds through `pw-mcp`
  using `/ms-playwright/chromium-1234/chrome-linux64/chrome`.

## Related Files

- `scripts/pw-mcp.sh` — The wrapper itself (~36 lines, executable)
- `Dockerfile` — `playwright install --with-deps chromium`, global pinned
  CLI installs, and `COPY scripts/pw-mcp.sh`
- `entrypoint.d/02-init-config.sh` — Regenerates `opencode.json` with
  `"command": ["pw-mcp"]` for `mcp.playwright`
- `test/run-tests.sh` — verifies direct `playwright` and `playwright-mcp`
  binaries, wrapper installation, config routing, and MCP browser navigation
- `docs/CHANGELOG.md` — `v0.17.0` entry documents the change

## Subagent Usage (Standalone Mode)

Subagents (Sisyphus-Junior, etc.) **cannot use the parent session's Playwright MCP
server**. When a subagent loads `load_skills=["playwright"]`, the `skill_mcp` tool
tries to launch its own MCP server via `npx @playwright/mcp@latest` — but this
container has no `npx` (only `bunx`), so the connection fails. The built-in
playwright skill's hardcoded `npx` command is not configurable.

> **Main agent (not a subagent) — use the MCP tools first.** The standalone-mode
> restriction above applies **only** to `task()`-spawned subagents. The main agent
> has the `playwright_browser_*` MCP tools directly available in-session and should
> try them first (zero install, zero setup) — e.g. `playwright_browser_navigate`
> against the target URL, then `playwright_browser_snapshot`. Fall back to the
> standalone script below only when the MCP tools are absent.
> For SPA targets (OpenChamber, OpenCode) use `waitUntil: 'domcontentloaded'` +
> a short `waitForTimeout` — `'networkidle'` never settles because of SSE/websocket
> streams. (Case: 2026-08-02 prod OpenChamber sync verification.)

The correct pattern for subagents is **Direct Playwright API**:

1. Write a standalone `.mjs` script that imports `playwright`
2. Use the bundled Chromium at `/ms-playwright/chromium-<rev>/chrome-linux64/chrome`
3. Launch via `bun run <script>` with `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`
4. Save all artifacts to `.playwright-mcp/` in the workspace root
5. Delete the temp script after use

This is codified in the project's baked playwright skill at
`.opencode/baked-skills/playwright/SKILL.md`, which overrides the built-in
skill at container startup via the entrypoint symlink mechanism (see
`patterns/baked-skills-mechanism.md`). The baked skill provides a full
boilerplate script with login, Chromium path resolution, and output directory.

```javascript
// Boilerplate (from baked skill)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const ADMIN_URL = 'http://172.20.0.1:8081';
const PASSWORD = 'testadmin123';
const OUTPUT_DIR = '/home/devuser/workspace/ai-engkit/.playwright-mcp';

mkdirSync(OUTPUT_DIR, { recursive: true });

async function login(page) {
  await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_BIN,
    args: ['--no-sandbox', '--headless'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await login(page);
    // ... test code ...
    await page.screenshot({ path: `${OUTPUT_DIR}/result.png`, fullPage: true });
  } finally {
    await browser.close();
  }
})();
```

### Why This Works

- Direct `import { chromium }` works because `playwright` is installed in the image
- Bundled Chromium is found at the known path; dynamic resolution handles version drift
- `.playwright-mcp/` is the same directory the MCP server uses, keeping all artifacts
  in one place regardless of whether the parent session or a subagent produced them
- Temp scripts are disposable — no persistent file pollution

## Tags

`#playwright` `#mcp` `#docker` `#browser-automation` `#wrapper-pattern`
`#subagent` `#standalone` `#opencode`
