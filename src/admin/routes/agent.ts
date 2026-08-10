import { Hono } from "hono";
import { readEnvFile, upsertEnvVar, deleteEnvVar } from "../lib/env";
import { reloadAgent, getAgentStatus } from "../agent";
import { AgentSettingsPage, type AgentSettingsState } from "../views/agent";

const AGENT_KEYS = ["CENTER_URL", "CENTER_TOKEN", "AGENT_ID"] as const;

export interface AgentConfigInput {
  CENTER_URL?: string;
  CENTER_TOKEN?: string;
  AGENT_ID?: string;
  [key: string]: unknown;
}

export interface AgentSettingsDeps {
  readEnv: () => Record<string, string>;
  upsert: (key: string, value: string) => void;
  remove: (key: string) => void;
  reload: () => AgentSettingsState;
  status: () => AgentSettingsState;
}

export const DEFAULT_AGENT_SETTINGS_DEPS: AgentSettingsDeps = {
  readEnv: readEnvFile,
  upsert: upsertEnvVar,
  remove: deleteEnvVar,
  reload: reloadAgent,
  status: getAgentStatus,
};

/** Validate an agent config payload. Returns an error message or null. */
export function validateAgentConfig(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Request body must be a JSON object";
  }
  const record = input as Record<string, unknown>;

  for (const key of AGENT_KEYS) {
    if (key in record && record[key] !== undefined && typeof record[key] !== "string") {
      return `${key} must be a string or omitted`;
    }
  }

  const centerUrl = typeof record.CENTER_URL === "string" ? record.CENTER_URL.trim() : "";
  if (centerUrl !== "") {
    let parsed: URL;
    try {
      parsed = new URL(centerUrl);
    } catch {
      return "CENTER_URL must be a valid URL";
    }
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return "CENTER_URL must use ws:// or wss://";
    }
  }

  return null;
}

/** Apply a validated config payload to the env file and reload the agent. */
export function applyAgentConfig(deps: AgentSettingsDeps, input: AgentConfigInput): void {
  for (const key of AGENT_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() !== "") {
      deps.upsert(key, value.trim());
    } else {
      deps.remove(key);
    }
  }
  deps.reload();
}

export function createAgentSettingsRoutes(deps: AgentSettingsDeps): Hono {
  const agent = new Hono();

  agent.put("/api/agent/config", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const error = validateAgentConfig(body);
    if (error !== null) return c.json({ error }, 400);

    applyAgentConfig(deps, (body ?? {}) as AgentConfigInput);
    return c.json({ ok: true, agent_status: deps.status() });
  });

  agent.get("/api/agent/status", (c) => {
    return c.json(deps.status());
  });

  agent.get("/agent", (c) => {
    const env = deps.readEnv();
    return c.html(
      AgentSettingsPage({
        status: deps.status(),
        env: Object.fromEntries(AGENT_KEYS.map((key) => [key, env[key] ?? ""])),
      }),
    );
  });

  return agent;
}

/** Default agent settings routes backed by the real env file and singleton runtime. */
export const agentRoutes = createAgentSettingsRoutes(DEFAULT_AGENT_SETTINGS_DEPS);

export default agentRoutes;