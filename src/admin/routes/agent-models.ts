import { Hono } from "hono";
import {
  createAgentModelsLib,
  validateFallbackModels,
  displayNameToKey,
  REAL_DEPS,
  type AgentModelsDeps,
  type AgentModelEntry,
  type AgentModelsLib,
  type ResolvedModel,
} from "../lib/agent-models";
import { AgentModelsPage } from "../views/agent-models";

const AGENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Merge configured agents with live /agent names into per-agent view entries. */
async function collectAgentModelState(
  lib: AgentModelsLib,
  password: string | null,
): Promise<{ agents: AgentModelEntry[]; catalog: string[]; hasPassword: boolean }> {
  const [config, resolvedMap, catalog] = await Promise.all([
    lib.readAgentModelsConfig(),
    password !== null ? lib.fetchResolvedAgentModels(password) : Promise.resolve(null),
    lib.fetchConnectedCatalog(password),
  ]);

  const knownKeys = new Set(Object.keys(config));
  // /agent returns display names ("Sisyphus - ultraworker"); map them back to
  // config keys so configured rows and resolved models line up.
  const resolvedByKey = new Map<string, ResolvedModel>();
  for (const [displayName, resolved] of resolvedMap ?? []) {
    const key = displayNameToKey(displayName, knownKeys) ?? displayName;
    if (!resolvedByKey.has(key)) resolvedByKey.set(key, resolved);
  }

  const names = [...new Set([...knownKeys, ...resolvedByKey.keys()])].sort();

  const agents: AgentModelEntry[] = names.map((name) => {
    const entry = config[name];
    const configured = entry?.models ?? [];
    let source: AgentModelEntry["source"] = "plugin";
    if (configured.length > 0) {
      source = "configured";
    } else if (name === "plan" && (config["prometheus"]?.models?.length ?? 0) > 0) {
      source = "inherited";
    }
    return {
      name,
      configured,
      resolved: resolvedByKey.get(name) ?? null,
      source,
      invalid: entry?.invalid ?? false,
    };
  });

  return { agents, catalog, hasPassword: password !== null };
}

export function createAgentModelsRoutes(deps: AgentModelsDeps): Hono {
  const lib = createAgentModelsLib(deps);
  const agentModels = new Hono();

  agentModels.get("/api/agent-models", async (c) => {
    const password = lib.getServerPassword();
    const state = await collectAgentModelState(lib, password);
    return c.json(state);
  });

  agentModels.put("/api/agent-models/:agent", async (c) => {
    const agent = c.req.param("agent").trim();
    if (!AGENT_KEY_PATTERN.test(agent)) {
      return c.json({ error: "invalid agent name" }, 400);
    }

    const body: unknown = await c.req.json().catch(() => null);
    const error = validateFallbackModels(body);
    if (error !== null) {
      return c.json({ error }, 400);
    }

    const password = lib.getServerPassword();
    if (password === null) {
      return c.json(
        {
          error:
            "OPENCODE_SERVER_PASSWORD is not set in .env — live verification and restart-on-save are unavailable. Set it via the Environment page to enable applying agent models.",
        },
        409,
      );
    }

    const entries = (body as { entries: Array<{ model: string; variant?: string }> }).entries;
    const result = await lib.applyAndVerify(agent, entries);
    return c.json(result);
  });

  agentModels.get("/agent-models", async (c) => {
    const password = lib.getServerPassword();
    const state = await collectAgentModelState(lib, password);
    return c.html(AgentModelsPage(state));
  });

  return agentModels;
}

export const agentModelsRoutes = createAgentModelsRoutes(REAL_DEPS);

export default agentModelsRoutes;
