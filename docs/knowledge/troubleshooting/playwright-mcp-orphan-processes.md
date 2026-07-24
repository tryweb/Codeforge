# Playwright MCP Leaves Orphan Chrome Processes

## Context

The ai-engkit image has Playwright bundled at `/ms-playwright/chromium-<rev>/` and an MCP server at `/usr/local/bin/pw-mcp` that wraps `@playwright/mcp`. Calling Playwright tools (e.g. `playwright_browser_navigate`, `browser_snapshot`) launches a persistent MCP server process:

```
bunx -y @playwright/mcp@<version> --executable-path=... --no-sandbox --headless
  └─ node playwright-mcp
      └─ /ms-playwright/chromium-<rev>/chrome-linux64/chrome
          ├─ chrome_crashpad_handler ×2
          ├─ chrome --type=zygote ×2
          ├─ chrome --type=gpu-process
          ├─ chrome --type=utility (network, storage)
          └─ chrome --type=renderer ×2
```

Each MCP server spawns ~14 Chrome processes over time, consuming ~1.5-2 GB RAM total.

## Problem

When a coding session ends or the agent disconnects, the MCP server and its Chrome processes are **not automatically killed**. They become orphaned and accumulate across sessions. In our case, two stale MCP servers (running for 3+ hours each) and one active Chrome with 13 sub-processes persisted after testing, consuming significant memory.

Attempting `pkill -f "ms-playwright/chromium"` can hang because Chrome sub-processes may be in uninterruptible sleep or take long to flush caches.

## Solution

1. **List all orphan MCP/chrome processes:**
   ```bash
   ps aux | grep -E "ms-playwright|playwright-mcp" | grep -v grep
   ```

2. **Kill with SIGKILL (instant), not SIGTERM:**
   ```bash
   # Kill MCP servers
   kill -9 <pid-of-bunx> <pid-of-node-playwright-mcp>
   
   # Kill all Chrome instances
   kill -9 $(ps aux | grep "ms-playwright/chromium" | awk '{print $2}')
   ```

3. **Verify:**
   ```bash
   ps aux | grep -c "ms-playwright|playwright-mcp"
   # Expected: 0
   ```

`SIGKILL` (`-9`) is necessary because `SIGTERM` (default for `pkill`/`kill`) may hang on Chrome processes flushing state to disk. `pkill -9` also works but may itself hang if a matcher blocks on a D-state process — prefer explicit `kill -9` with PIDs from `ps`.

## Why It Works

SIGKILL bypasses process shutdown handlers and instantly terminates the process and its children. Chrome processes are designed to handle abrupt termination (they use crashpad for crash reporting and recover on next launch), so force-killing is safe for a development environment.

## Side Effects / Tradeoffs

- Any in-progress Playwright automation will be interrupted.
- Chrome crash reports may be generated in `/home/devuser/.config/google-chrome-for-testing/Crash Reports/` — harmless, can be deleted.
- Next Playwright MCP invocation will spawn fresh processes automatically.

## Evidence

- Two MCP servers with elapsed times of 3h28m and 3h21m were found — both from earlier testing sessions.
- 14 Chrome processes from a single MCP instance consuming ~1.5-2 GB.
- After `kill -9` on all PIDs, zero processes remained.
- Next Playwright tool call started a clean MCP server successfully.

## Related Files

- `/usr/local/bin/pw-mcp` — MCP launcher wrapper
- `/ms-playwright/` — bundled Playwright browsers
- `.playwright-mcp/` — MCP output directory (autocreated in cwd)

## Tags

`playwright`, `mcp`, `orphan-processes`, `chrome`, `cleanup`, `memory-leak`
