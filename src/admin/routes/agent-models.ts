import { Hono } from "hono";
import {
  collectAgentModelState,
  createAgentModelsLib,
  validateFallbackModels,
  REAL_DEPS,
  type AgentModelsDeps,
  type AgentModelsLib,
} from "../lib/agent-models";
import { AgentModelsPage } from "../views/agent-models";

const AGENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

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
