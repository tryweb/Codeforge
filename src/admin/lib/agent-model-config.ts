import {
  OMO_CONFIG,
  VARIANTS,
  type AgentModelConfig,
  type FallbackModelEntry,
} from "./agent-model-types";

// Provider segment must be slash-free; the model segment may itself contain
// slashes (e.g. nvidia/<org>/<model> ids served by the live catalog).
const MODEL_REFERENCE_PATTERN = /^[^/\s]+\/\S+$/;
const VALID_AGENT_KEYS = new Set([
  "description",
  "prompt",
  "model",
  "models",
  "fallback_models",
  "reasoning",
  "variant",
  "reasoningEffort",
  "tools",
  "execution_mode",
  "background",
  "max_depth",
  "allowed_subagents",
  "disallowed_tools",
  "max_turns",
  "temperature",
  "disable",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateFallbackModels(input: unknown): string | null {
  if (!isRecord(input)) return "Request body must be a JSON object";
  if (!Array.isArray(input.entries)) return "entries must be an array of { model, variant? }";

  for (const entry of input.entries) {
    if (!isRecord(entry)) return "each entry must be an object";
    if (typeof entry.model !== "string" || entry.model.trim().length === 0) {
      return "each entry must have a non-empty string model";
    }
    if (!MODEL_REFERENCE_PATTERN.test(entry.model)) {
      return "each model must use the provider/model format";
    }
    if (entry.variant !== undefined && !VARIANTS.some((variant) => variant === entry.variant)) {
      return `variant must be one of ${VARIANTS.join(", ")}`;
    }
  }
  return null;
}

export function buildJqWriteCommand(agent: string, entries: readonly FallbackModelEntry[]): string {
  const out = "/tmp/omo.jsonc.tmp";
  const [primary] = entries;
  if (primary === undefined) {
    return `jq --arg agent '${agent}' 'del(.agents[$agent].model, .agents[$agent].variant, .agents[$agent].models, .agents[$agent].fallback_models)' ${OMO_CONFIG} > ${out} && mv ${out} ${OMO_CONFIG}`;
  }
  const variantSet = primary.variant
    ? ` | .agents[$agent].variant = ${JSON.stringify(primary.variant)}`
    : " | del(.agents[$agent].variant)";
  return `jq --arg model '${primary.model}' --arg agent '${agent}' '.agents[$agent].model = $model${variantSet} | del(.agents[$agent].models, .agents[$agent].fallback_models)' ${OMO_CONFIG} > ${out} && mv ${out} ${OMO_CONFIG}`;
}

export function displayNameToKey(displayName: string, knownKeys: ReadonlySet<string>): string | null {
  const lower = displayName.toLowerCase().trim();
  if (knownKeys.has(lower)) return lower;
  const [prefix] = lower.split(" - ");
  const base = (prefix ?? lower).trim();
  const hyphenated = base.replace(/\s+/g, "-");
  if (knownKeys.has(base)) return base;
  if (knownKeys.has(hyphenated)) return hyphenated;
  return null;
}

function toConfiguredEntries(entry: Record<string, unknown>): readonly FallbackModelEntry[] {
  const chain: FallbackModelEntry[] = [];
  if (typeof entry.model === "string" && entry.model.trim().length > 0) {
    const variant = typeof entry.variant === "string" ? entry.variant : undefined;
    chain.push({ model: entry.model, ...(variant ? { variant } : {}) });
  }
  const fallback = Array.isArray(entry.fallback_models) ? entry.fallback_models : [];
  const models = Array.isArray(entry.models) ? entry.models : [];
  for (const model of [...fallback, ...models]) {
    if (typeof model === "string") {
      chain.push({ model });
    } else if (isRecord(model) && typeof model.model === "string" && model.model.trim().length > 0) {
      const variant = typeof model.variant === "string" ? model.variant : undefined;
      chain.push({ model: model.model, ...(variant ? { variant } : {}) });
    }
  }
  return chain;
}

export function parseAgentModelsConfig(stdout: string): Record<string, AgentModelConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const config: Record<string, AgentModelConfig> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    config[name] = {
      model: typeof value.model === "string" ? value.model : undefined,
      variant: typeof value.variant === "string" ? value.variant : undefined,
      models: toConfiguredEntries(value),
      invalid: Object.keys(value).some((key) => !VALID_AGENT_KEYS.has(key)),
    };
  }
  return config;
}
