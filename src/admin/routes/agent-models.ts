import { Hono } from "hono";
import {
  collectAgentModelState,
  createAgentModelsLib,
  validateFallbackModels,
  REAL_DEPS,
  type AgentModelsDeps,
  type AgentModelsLib,
} from "../lib/agent-models";
import { parseModelReference, probeModel, type ProbeResult } from "../lib/model-probe";
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
    if (!state.catalogAvailable && entries.length > 0) {
      return c.json({ error: "model catalog unavailable" }, 409);
    }
    const catalog = new Set(state.catalog);
    if (entries.some((entry) => !catalog.has(entry.model))) {
      return c.json({ error: "model is not available in the current environment catalog" }, 400);
    }

    for (const entry of entries) {
      const ref = parseModelReference(entry.model);
      if (ref === null) continue;
      const probe: ProbeResult = await probeModel(deps, ref.providerID, ref.modelID);
      if (probe.status === "retired") {
        return c.json({ error: `model ${entry.model} has been retired (end of life): ${probe.reason ?? ""}` }, 400);
      }
      if (probe.status === "unavailable") {
        return c.json({ error: `model ${entry.model} is unavailable: ${probe.reason ?? ""}` }, 400);
      }
    }

    const result = await lib.applyAndVerify(agent, entries);
    return c.json(result);
  });

  agentModels.get("/api/agent-models/verify-model", async (c) => {
    const modelRef = c.req.query("model");
    if (!modelRef) return c.json({ error: "model parameter required" }, 400);

    const ref = parseModelReference(modelRef);
    if (ref === null) return c.json({ error: "invalid model format — expected provider/model" }, 400);

    const probe = await probeModel(deps, ref.providerID, ref.modelID);
    return c.json({ model: modelRef, ...probe });
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
