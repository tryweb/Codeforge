#!/usr/bin/env bash
# Wrapper for @playwright/mcp that resolves the Playwright-bundled Chromium at
# runtime and passes it via --executable-path. Required because:
#   1. @playwright/mcp's --browser flag maps to Chrome/Firefox/WebKit/Edge
#      channels, not to the Playwright-bundled Chromium binary.
#   2. The bundled Chromium lives at /ms-playwright/chromium-<revision>/...
#      where <revision> changes with every Playwright release.
#   3. This image has no system Google Chrome installed, so the MCP server
#      would otherwise fail to locate a browser.
set -euo pipefail

PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
PLAYWRIGHT_MCP_VERSION="${PLAYWRIGHT_MCP_VERSION:-latest}"

find_executable() {
    local name="$1"
    local path_pattern="$2"
    local candidate

    while IFS= read -r -d '' candidate; do
        if [ -x "${candidate}" ]; then
            printf '%s' "${candidate}"
            return 0
        fi
    done < <(find "${PLAYWRIGHT_BROWSERS_PATH}" \
        -type f -name "${name}" -path "${path_pattern}" -print0 2>/dev/null | sort -z -V -r)
}

if [ ! -d "${PLAYWRIGHT_BROWSERS_PATH}" ]; then
    echo "pw-mcp: browser directory does not exist: ${PLAYWRIGHT_BROWSERS_PATH}" >&2
    exit 127
fi

CHROME_BIN="$(find_executable chrome '*/chromium-*/chrome-linux64/*' || true)"

if [ -z "${CHROME_BIN}" ]; then
    CHROME_BIN="$(find_executable chrome-headless-shell '*/chromium_headless_shell-*/chrome-headless-shell-linux64/*' || true)"
fi

if [ -z "${CHROME_BIN}" ]; then
    echo "pw-mcp: no bundled Chromium found under ${PLAYWRIGHT_BROWSERS_PATH}" >&2
    echo "pw-mcp: expected an executable at chromium-<rev>/chrome-linux64/chrome" >&2
    exit 127
fi

export PLAYWRIGHT_BROWSERS_PATH
echo "pw-mcp: using $(basename "$(dirname "$(dirname "$CHROME_BIN")")") (${CHROME_BIN})" >&2

exec bunx -y "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" \
    --executable-path="${CHROME_BIN}" \
    --no-sandbox --headless \
    --output-dir .playwright-mcp \
    "$@"
