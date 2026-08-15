import { Hono } from "hono";
import {
  createAgentModelsLib,
  validateFallbackModels,
  displayNameToKey,
  CONFIGURABLE_NATIVE_AGENTS,
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
  const [config, resolvedMap, catalog, subagentNames] = await Promise.all([
    lib.readAgentModelsConfig(),
    password !== null ? lib.fetchResolvedAgentModels(password) : Promise.resolve(null),
    lib.fetchConnectedCatalog(password),
    password !== null ? lib.fetchSubagentNames(password) : Promise.resolve([]),
  ]);

  const knownKeys = new Set(Object.keys(config));
  // /agent returns display names ("Sisyphus - ultraworker"); map them back to
  // config keys so configured rows and resolved models line up.
  const resolvedByKey = new Map<string, ResolvedModel>();
  for (const [displayName, resolved] of resolvedMap ?? []) {
    const key = displayNameToKey(displayName, knownKeys) ?? displayName;
    if (!resolvedByKey.has(key)) resolvedByKey.set(key, resolved);
  }

  // Include the opencode-native subagents that are safe to configure (e.g.
  // general); internal mechanism agents (compaction, summary, title, build)
  // stay out because changing their model can break opencode internals.
  const configurableKeys = new Set<string>();
  for (const displayName of subagentNames) {
    const key = displayNameToKey(displayName, knownKeys) ?? displayName.toLowerCase();
    if (knownKeys.has(key) || (CONFIGURABLE_NATIVE_AGENTS as readonly string[]).includes(key)) {
      configurableKeys.add(key);
    }
  }

  const names = [...configurableKeys].sort();

  const agents: AgentModelEntry[] = names.map((name) => {
    const entry = config[name];
    const configured = entry?.model
      ? [{ model: entry.model, ...(entry.variant ? { variant: entry.variant } : {}) }]
      : [];
    const resolved = resolvedByKey.get(name) ?? null;
    let source: AgentModelEntry["source"] = "plugin";
    if (configured.length > 0) {
      source = "configured";
    } else if (name === "plan" && config["prometheus"]?.model !== undefined) {
      source = "inherited";
    }
    let effectiveness: AgentModelEntry["effectiveness"] = "plugin";
    if (entry?.invalid === true) {
      effectiveness = "invalid";
    } else if (configured.length > 0) {
      const configuredModel = configured[0]?.model;
      if (resolved === null || configuredModel === undefined) {
        effectiveness = "unverified";
      } else if (`${resolved.providerID}/${resolved.modelID}` === configuredModel) {
        effectiveness = "effective";
      } else {
        effectiveness = "runtime_mismatch";
      }
    } else if (resolved === null) {
      effectiveness = "unverified";
    }
    return {
      name,
      configured,
      resolved,
      source,
      invalid: entry?.invalid ?? false,
      effectiveness,
    };
  });

  return { agents, catalog: [...catalog], hasPassword: password !== null };
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
    const state = await collectAgentModelState(lib, password);
    if (!state.agents.some((entry) => entry.name === agent)) {
      return c.json({ error: "agent is not a configurable live subagent" }, 403);
    }
    const catalog = new Set(state.catalog);
    if (entries.some((entry) => !catalog.has(entry.model))) {
      return c.json({ error: "model is not available in the current environment catalog" }, 400);
    }
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
