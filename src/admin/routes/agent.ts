import { Hono } from "hono";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { readEnvFile, upsertEnvVar, deleteEnvVar } from "../lib/env";
import { reloadAgent, getAgentStatus } from "../agent";
import { extractCaFromUrl, extractTokenFromUrl } from "../agent/protocol";
import { AgentSettingsPage, type AgentSettingsState } from "../views/agent";

const AGENT_KEYS = ["CENTER_URL", "CENTER_TOKEN", "AGENT_ID", "CENTER_CA_CERT"] as const;
const CENTER_CA_PATH = "/opt/ai-engkit/center-ca.pem";

export interface AgentConfigInput {
  CENTER_URL?: string;
  CENTER_TOKEN?: string;
  AGENT_ID?: string;
  CENTER_CA_CERT?: string;
  [key: string]: unknown;
}

export interface AgentSettingsDeps {
  readEnv: () => Record<string, string>;
  upsert: (key: string, value: string) => void;
  remove: (key: string) => void;
  writeCa: (content: string) => void;
  removeCa: () => void;
  reload: () => AgentSettingsState;
  status: () => AgentSettingsState;
}

export const DEFAULT_AGENT_SETTINGS_DEPS: AgentSettingsDeps = {
  readEnv: readEnvFile,
  upsert: upsertEnvVar,
  remove: deleteEnvVar,
  writeCa: (content) => writeFileSync(CENTER_CA_PATH, content, { encoding: "utf-8", mode: 0o600 }),
  removeCa: () => {
    if (existsSync(CENTER_CA_PATH)) unlinkSync(CENTER_CA_PATH);
  },
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
  const rawCenterUrl = input.CENTER_URL?.trim() ?? "";
  let centerUrl = rawCenterUrl;
  let embeddedToken: string | null = null;
  let embeddedCa: string | null = null;

  if (rawCenterUrl !== "") {
    const parsed = new URL(rawCenterUrl);
    embeddedToken = extractTokenFromUrl(rawCenterUrl);
    embeddedCa = extractCaFromUrl(rawCenterUrl);
    if (embeddedToken !== null) parsed.searchParams.delete("token");
    if (embeddedCa !== null) parsed.searchParams.delete("ca");
    centerUrl = parsed.toString();
  }

  if (centerUrl !== "") deps.upsert("CENTER_URL", centerUrl);
  else deps.remove("CENTER_URL");

  const token = embeddedToken || input.CENTER_TOKEN?.trim() || "";
  if (token !== "") deps.upsert("CENTER_TOKEN", token);
  else deps.remove("CENTER_TOKEN");

  const agentId = input.AGENT_ID?.trim() ?? "";
  if (agentId !== "") deps.upsert("AGENT_ID", agentId);
  else deps.remove("AGENT_ID");

  if (embeddedCa !== null) {
    deps.writeCa(embeddedCa);
    deps.upsert("CENTER_CA_CERT", CENTER_CA_PATH);
  } else {
    const caPath = input.CENTER_CA_CERT?.trim() ?? "";
    if (caPath !== "") deps.upsert("CENTER_CA_CERT", caPath);
    else {
      deps.removeCa();
      deps.remove("CENTER_CA_CERT");
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
    const env = deps.readEnv();
    return c.json({
      ok: true,
      agent_status: deps.status(),
      agent_config: Object.fromEntries(AGENT_KEYS.map((key) => [key, env[key] ?? ""])),
    });
  });

  agent.get("/api/agent/status", (c) => {
    return c.json(deps.status());
  });

  agent.get("/agent", (c) => {
    const env = deps.readEnv();
    const centerUrl = env.CENTER_URL ?? "";
    const token = env.CENTER_TOKEN ?? extractTokenFromUrl(centerUrl) ?? "";
    if (centerUrl !== "") {
      const parsed = new URL(centerUrl);
      parsed.searchParams.delete("token");
      parsed.searchParams.delete("ca");
      env.CENTER_URL = parsed.toString();
    }
    env.CENTER_TOKEN = token;
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
