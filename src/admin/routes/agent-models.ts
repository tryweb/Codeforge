import { Hono } from "hono";
import {
  collectAgentModelState,
  createAgentModelsLib,
  validateFallbackModels,
  REAL_DEPS,
  type AgentModelsDeps,
  type AgentModelsLib,
  type ApplyResult,
} from "../lib/agent-models";
import { createAgentModelReconciler } from "../lib/agent-model-reconciler";
import { parseModelReference, probeModel, type ProbeResult } from "../lib/model-probe";
import { AgentModelsPage } from "../views/agent-models";

const AGENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_MODES = new Set(["free", "economy", "performance"] as const);
type SuggestionMode = "free" | "economy" | "performance";

function validateSuggestionBody(
  body: unknown,
): { readonly providers: readonly string[] | null; readonly mode?: SuggestionMode } | string {
  if (body === undefined || body === null) return { providers: null };
  if (typeof body !== "object" || Array.isArray(body)) return "Request body must be a JSON object";
  const record = body as Record<string, unknown>;
  const providersRaw = record.providers;
  let providers: readonly string[] | null = null;
  if (providersRaw !== undefined) {
    if (!Array.isArray(providersRaw) || providersRaw.some((provider) => typeof provider !== "string" || provider.trim().length === 0)) {
      return "providers must be an array of non-empty strings";
    }
    providers = [...new Set(providersRaw.map((provider) => provider.trim()))];
  }
  const modeRaw = record.mode;
  if (modeRaw !== undefined) {
    if (typeof modeRaw !== "string" || !ALLOWED_MODES.has(modeRaw as SuggestionMode)) {
      return "mode must be one of free, economy, performance";
    }
    return { providers, mode: modeRaw as SuggestionMode };
  }
  return { providers };
}

function validateBatchBody(body: unknown): { changes: Array<{ agent: string; entries: Array<{ model: string; variant?: string }> }> } | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "Request body must be a JSON object with changes array";
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.changes)) return "changes must be an array";
  const changes = record.changes as unknown[];
  if (changes.length === 0) return "changes must not be empty";
  for (const item of changes) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return "each change must be an object with agent and entries";
    const change = item as Record<string, unknown>;
    const agent = change.agent;
    if (typeof agent !== "string" || !AGENT_KEY_PATTERN.test(agent.trim())) return "each change requires a valid agent name";
    const error = validateFallbackModels({ entries: change.entries });
    if (error !== null) return `agent ${agent}: ${error}`;
  }
  return { changes: changes as Array<{ agent: string; entries: Array<{ model: string; variant?: string }> }> };
}

export function createAgentModelsRoutes(deps: AgentModelsDeps): Hono {
  const lib = createAgentModelsLib(deps);
  const reconciler = createAgentModelReconciler(deps);
  const agentModels = new Hono();

  agentModels.get("/api/agent-models", async (c) => {
    const password = lib.getServerPassword();
    const state = await collectAgentModelState(lib, password);
    return c.json(state);
  });

  agentModels.post("/api/agent-models/suggestions", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = validateSuggestionBody(body);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const password = lib.getServerPassword();
    if (password === null) return c.json({ error: "OPENCODE_SERVER_PASSWORD is not set in .env" }, 409);
    const state = await collectAgentModelState(lib, password);
    if (!state.catalogAvailable) return c.json({ error: "model catalog unavailable" }, 409);

    const connected = new Set(state.providers);
    const unknown = parsed.providers?.find((provider) => !connected.has(provider));
    if (unknown !== undefined) return c.json({ error: `provider ${unknown} is not connected` }, 400);
    const selected = parsed.providers === null || parsed.providers.length === 0
      || parsed.providers.length === state.providers.length
      ? null
      : parsed.providers;
    if (parsed.mode !== undefined) {
      const out = await reconciler.suggestExplicit(parsed.mode, selected);
      const suggestions: Record<string, { readonly model: string; readonly metadata: { readonly inputPrice: number | null; readonly outputPrice: number | null; readonly contextLimit: number | null; readonly outputLimit: number | null; readonly reasoning: boolean | null; readonly toolCall: boolean | null; readonly structuredOutput: boolean | null; readonly deprecated: boolean }; readonly reason: string; readonly heuristic: boolean }> = {};
      for (const [agent, entry] of out.suggestions) {
        suggestions[agent] = {
          model: entry.model,
          metadata: { ...entry.metadata },
          reason: entry.reason,
          heuristic: entry.heuristic,
        };
      }
      return c.json({
        mode: out.mode,
        providers: [...out.providers],
        sourceStatus: out.sourceStatus,
        sourceAgeMs: out.sourceAgeMs,
        warnings: [...out.warnings],
        suggestions,
      });
    }
    const suggestions = await reconciler.suggest(selected);
    const result: Record<string, readonly { readonly model: string; readonly variant?: string }[]> = {};
    for (const [agent, entries] of suggestions) result[agent] = entries;
    return c.json({ suggestions: result, providers: state.providers });
  });

  // Batch endpoint: single restart for N changes
  agentModels.put("/api/agent-models", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = validateBatchBody(body);
    if (typeof parsed === "string") {
      return c.json({ error: parsed }, 400);
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

    const state = await collectAgentModelState(lib, password);
    const knownAgents = new Set(state.agents.map((entry) => entry.name));
    for (const change of parsed.changes) {
      const agent = change.agent.trim();
      if (!knownAgents.has(agent)) {
        return c.json({ error: `agent ${agent} is not a configurable live subagent` }, 403);
      }
    }
    if (!state.catalogAvailable && parsed.changes.some((change) => change.entries.length > 0)) {
      return c.json({ error: "model catalog unavailable" }, 409);
    }
    const catalog = new Set(state.catalog);
    for (const change of parsed.changes) {
      if (change.entries.some((entry) => !catalog.has(entry.model))) {
        return c.json({ error: `model ${change.entries.find((e) => !catalog.has(e.model))?.model} is not available in the current environment catalog` }, 400);
      }
    }

    for (const change of parsed.changes) {
      for (const entry of change.entries) {
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
    }

    // Single snapshot/write/restart for the whole batch
    const batchChanges = parsed.changes.map((change) => ({ agent: change.agent.trim(), entries: change.entries }));
    const results = await lib.applyAndVerifyBatch(batchChanges);
    const resultsRecord: Record<string, ApplyResult> = {};
    for (const [agent, result] of results) {
      resultsRecord[agent] = result;
    }
    return c.json({ results: resultsRecord });
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

    const result = await reconciler.applyAgent(agent, entries);
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
