import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { OpenChamberSettingsPage } from "../views/openchamber";

const DEFAULT_SETTINGS = { showOpenCodeUpdateNotifications: false };

export interface OpenChamberAdminSettings {
  showOpenCodeUpdateNotifications: boolean;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AiDevCommand = (command: string, timeoutMs: number) => Promise<CommandResult>;

function readSettingsCommand(settingsPath: string): string {
  return `SETTINGS=${JSON.stringify(settingsPath)}; ` +
    `mkdir -p "$(dirname \"$SETTINGS\")" && ` +
    `if [ ! -e "$SETTINGS" ]; then printf '%s\\n' '${JSON.stringify(DEFAULT_SETTINGS)}' > "$SETTINGS"; fi && ` +
    `jq -e -c 'if type == "object" then {showOpenCodeUpdateNotifications: (.showOpenCodeUpdateNotifications // false)} else error("settings must be an object") end' "$SETTINGS"`;
}

function writeSettingsCommand(settingsPath: string, showOpenCodeUpdateNotifications: boolean): string {
  return `SETTINGS=${JSON.stringify(settingsPath)}; ` +
    `mkdir -p "$(dirname \"$SETTINGS\")" && ` +
    `if [ ! -e "$SETTINGS" ]; then printf '%s\\n' '${JSON.stringify(DEFAULT_SETTINGS)}' > "$SETTINGS"; fi && ` +
    `umask 077; TMP="$(mktemp "${settingsPath}.tmp.XXXXXX")" && ` +
    `jq -e --argjson value ${JSON.stringify(showOpenCodeUpdateNotifications)} ` +
    `'if type != "object" then error("settings must be an object") elif has("showOpenCodeUpdateNotifications") and (.showOpenCodeUpdateNotifications | type != "boolean") then error("update notification setting must be boolean") else .showOpenCodeUpdateNotifications = $value end' ` +
    `"$SETTINGS" > "$TMP" || { rm -f "$TMP"; exit 1; }; mv "$TMP" "$SETTINGS"`;
}

function parseSettings(stdout: string): OpenChamberAdminSettings | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>).showOpenCodeUpdateNotifications;
    return typeof value === "boolean" ? { showOpenCodeUpdateNotifications: value } : null;
  } catch {
    return null;
  }
}

function errorMessage(result: CommandResult, fallback: string): string {
  return result.stderr.trim() || fallback;
}

export interface OpenChamberRoutesOptions {
  command?: AiDevCommand;
  settingsPath?: string;
}

export function createOpenChamberRoutes(options: OpenChamberRoutesOptions = {}) {
  const command = options.command ?? execInAiDev;
  const settingsPath = options.settingsPath ?? "/home/devuser/.config/openchamber/settings.json";
  const openchamber = new Hono();

  openchamber.get("/api/openchamber/settings", async (c) => {
    const result = await command(readSettingsCommand(settingsPath), 10_000);
    if (result.exitCode !== 0) {
      return c.json({ error: errorMessage(result, "Could not read OpenChamber settings") }, 500);
    }

    const settings = parseSettings(result.stdout);
    if (!settings) {
      return c.json({ error: "OpenChamber settings are malformed" }, 500);
    }
    return c.json(settings);
  });

  openchamber.put("/api/openchamber/settings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be an object" }, 400);
    }

    const value = (body as Record<string, unknown>).showOpenCodeUpdateNotifications;
    if (typeof value !== "boolean") {
      return c.json({ error: "showOpenCodeUpdateNotifications must be a boolean" }, 400);
    }

    const result = await command(writeSettingsCommand(settingsPath, value), 10_000);
    if (result.exitCode !== 0) {
      return c.json({ error: errorMessage(result, "Could not update OpenChamber settings") }, 500);
    }
    return c.json({ ok: true, showOpenCodeUpdateNotifications: value });
  });

  openchamber.get("/openchamber", (c) => c.html(OpenChamberSettingsPage()));
  return openchamber;
}

export default createOpenChamberRoutes();
