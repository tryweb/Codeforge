---
name: playwright
description: Browser automation via Playwright for ai-engkit Docker environments. Overrides built-in playwright skill with ai-engkit-specific Chromium path, bunx runner, and .playwright-mcp output directory.
---

# Playwright Browser Automation (ai-engkit)

This skill overrides the built-in playwright skill with ai-engkit Docker
environment paths. It is auto-symlinked to the user config from
`/opt/opencode/baked-skills/playwright/` at container startup.

## Constraints

- **No system Chrome** — only Playwright-bundled Chromium at `/ms-playwright/`
- **No `npx`** — use `bunx` or `bun run` instead
- **Subagents cannot use parent session's MCP server** — `skill_mcp` with
  `mcp_name="playwright"` will fail because the underlying command is hardcoded
  to `npx @playwright/mcp@latest` which is not in PATH
- **DooD networking** — sibling containers are accessible via bridge gateway,
  not `localhost` (see `.opencode/AGENTS.md.default`)

## How to Use (for subagents)

Write a standalone `.mjs` script, run it via `bun run`, save output to
`.playwright-mcp/` in the workspace root, then delete the temp file.

### Chromium Path

```javascript
const CHROME_BIN = '/ms-playwright/chromium-1228/chrome-linux64/chrome';
// Dynamic resolution:
// const CHROME_BIN = require('child_process')
//   .execSync('find /ms-playwright -type f -name chrome -path "*/chromium-*/chrome-linux64/*" 2>/dev/null | sort -V | tail -1')
//   .toString().trim();
```

### Output Directory

All artifacts **MUST** go to `.playwright-mcp/` in the workspace root:

```javascript
const OUTPUT_DIR = '/home/devuser/workspace/ai-engkit/.playwright-mcp';
```

### Running the Script

```bash
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright bun run /tmp/pw-test.mjs
```

### Cleanup

```bash
rm -f /tmp/pw-test.mjs
```

## Boilerplate

```javascript
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
    await page.goto(`${ADMIN_URL}/auth/github`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUTPUT_DIR}/github-auth.png`, fullPage: true });
    console.log('done');
  } finally {
    await browser.close();
  }
})();
```

## Tags

`#playwright` `#browser-test` `#e2e` `#screenshot` `#ai-engkit`
