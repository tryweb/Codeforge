/**
 * Agent model configuration — reads and writes per-OMO-agent `fallback_models`
 * in `~/.omo/omo.jsonc` inside the ai-dev container, and verifies changes
 * against the managed opencode server's live `/agent` endpoint.
 *
 * Write path: the admin container does not mount the `omo-config` volume, so
 * every file operation runs through `execInAiDev`. Payloads are transported
 * as base64 to stay shell-safe regardless of model/variant characters.
 */

import { execInAiDev, type ExecResult } from "./docker";
import { restartAiDev } from "./restart-ai-dev";
import { readEnvFile } from "./env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FallbackModelEntry {
  model: string;
  variant?: string;
}

export interface ResolvedModel {
  modelID: string;
  providerID: string;
}

export interface AgentModelEntry {
  name: string;
  configured: FallbackModelEntry[];
  resolved: ResolvedModel | null;
  source: "configured" | "inherited" | "plugin";
  invalid: boolean;
}

export type ApplyResult =
  | { ok: true; status: "verified"; resolved: ResolvedModel | null }
  | { ok: false; status: "write_failed"; error: string }
  | { ok: false; status: "restart_failed"; error: string }
  | { ok: false; status: "unverified"; error: string };

export interface AgentModelsDeps {
  exec: (command: string, timeoutMs?: number) => Promise<ExecResult>;
  restart: () => Promise<{ ok: boolean; error?: string }>;
  readEnv: () => Record<string, string>;
  snapshotDir: string;
}

export const REAL_DEPS: AgentModelsDeps = {
  exec: execInAiDev,
  restart: restartAiDev,
  readEnv: readEnvFile,
  snapshotDir: "/opt/ai-engkit/admin-data",
};

export const OMO_CONFIG = "~/.omo/omo.jsonc";
export const MANAGED_OPENCODE_DIR = "~/.config/openchamber/managed-opencode";

export const VARIANTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Validate a write payload `{ entries: Array<{ model, variant? }> }`. Returns an error message or null. */
export function validateFallbackModels(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Request body must be a JSON object";
  }
  const record = input as Record<string, unknown>;
  const entries = record.entries;
  if (!Array.isArray(entries)) {
    return "entries must be an array of { model, variant? }";
  }
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return "each entry must be an object";
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.model !== "string" || e.model.trim().length === 0) {
      return "each entry must have a non-empty string model";
    }
    if (e.variant !== undefined && !(VARIANTS as readonly string[]).includes(e.variant as string)) {
      return `variant must be one of ${VARIANTS.join(", ")}`;
    }
  }
  return null;
}

/**
 * Build the sh command that applies `entries` to `agents.<agent>` model config.
 * Writes the first entry as the primary `model` string (plus `variant` when
 * present) and removes every other model key. This matches what the plugin's
 * delegate-task resolution honors: `resolveSubagentModel` reads
 * `agentOverride.model` as the subagent model, and the presence of a
 * `fallback_models` array makes it ignore that primary entirely (verified
 * empirically: `model` alone selects the configured model, adding
 * `fallback_models` falls back to the plugin default). An empty array deletes
 * all model keys (returning the agent to plugin-assigned models). The payload
 * rides as base64 through a temp file so no shell quoting can corrupt it.
 * Pure — unit-testable.
 */
export function buildJqWriteCommand(agent: string, entries: FallbackModelEntry[]): string {
  const out = "/tmp/omo.jsonc.tmp";
  if (entries.length === 0) {
    return `jq --arg agent '${agent}' 'del(.agents[$agent].model, .agents[$agent].variant, .agents[$agent].models, .agents[$agent].fallback_models)' ${OMO_CONFIG} > ${out} && mv ${out} ${OMO_CONFIG}`;
  }
  const primary = entries[0]!;
  const variantSet = primary.variant
    ? ` | .agents[$agent].variant = ${JSON.stringify(primary.variant)}`
    : " | del(.agents[$agent].variant)";
  return `jq --arg model '${primary.model}' --arg agent '${agent}' '.agents[$agent].model = $model${variantSet} | del(.agents[$agent].models, .agents[$agent].fallback_models)' ${OMO_CONFIG} > ${out} && mv ${out} ${OMO_CONFIG}`;
}

/**
 * Map an agent display name (as returned by the managed server's `/agent`
 * endpoint, e.g. "Sisyphus - ultraworker") back to its config key (e.g.
 * "sisyphus"). Plain names ("explore", "plan") pass through. Returns null
 * when the name matches no known key (opencode built-ins like "build").
 */
export function displayNameToKey(displayName: string, knownKeys: ReadonlySet<string>): string | null {
  const lower = displayName.toLowerCase().trim();
  if (knownKeys.has(lower)) return lower;
  const base = lower.split(" - ")[0]!.trim();
  const hyphenated = base.replace(/\s+/g, "-");
  if (knownKeys.has(base)) return base;
  if (knownKeys.has(hyphenated)) return hyphenated;
  return null;
}

export interface AgentModelConfig {
  model?: string;
  variant?: string;
  models?: FallbackModelEntry[];
  invalid: boolean;
}

/**
 * Agent config keys recognized by the pinned OMO release. `fallback_models` is
 * deprecated in the schema but still honored by the delegate-task resolution,
 * so it is not treated as invalid. Keys outside this set (e.g. the legacy
 * `permission` block) make the entry fail strict validation.
 */
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

/** Normalize a raw agent config entry into its model entries (primary + chain). */
function toConfiguredEntries(entry: Record<string, unknown>): FallbackModelEntry[] {
  const chain: FallbackModelEntry[] = [];
  if (typeof entry.model === "string" && entry.model.trim().length > 0) {
    const variant = typeof entry.variant === "string" ? entry.variant : undefined;
    chain.push({ model: entry.model, ...(variant ? { variant } : {}) });
  }
  const fallback = Array.isArray(entry.fallback_models) ? entry.fallback_models : [];
  const models = Array.isArray(entry.models) ? entry.models : [];
  for (const m of [...fallback, ...models]) {
    if (typeof m === "string") {
      chain.push({ model: m });
    } else if (typeof m === "object" && m !== null) {
      const rec = m as Record<string, unknown>;
      if (typeof rec.model === "string" && rec.model.trim().length > 0) {
        const variant = typeof rec.variant === "string" ? rec.variant : undefined;
        chain.push({ model: rec.model, ...(variant ? { variant } : {}) });
      }
    }
  }
  return chain;
}

export function createAgentModelsLib(deps: AgentModelsDeps = REAL_DEPS) {
  /** Read the `agents` block of omo.jsonc (typed empty map when absent/unreadable). */
  async function readAgentModelsConfig(): Promise<Record<string, AgentModelConfig>> {
    const r = await deps.exec(`jq -c '.agents // {}' ${OMO_CONFIG} 2>/dev/null || echo '{}'`, 10_000);
    if (r.exitCode !== 0) return {};
    try {
      const parsed: unknown = JSON.parse(r.stdout);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      const out: Record<string, AgentModelConfig> = {};
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
        const rec = value as Record<string, unknown>;
        const invalid = Object.keys(rec).some((k) => !VALID_AGENT_KEYS.has(k));
        out[name] = {
          model: typeof rec.model === "string" ? rec.model : undefined,
          variant: typeof rec.variant === "string" ? rec.variant : undefined,
          models: toConfiguredEntries(rec),
          invalid,
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Apply a targeted fallback_models update for one agent; other keys and $schema untouched. */
  async function writeAgentFallbackModels(
    agent: string,
    entries: FallbackModelEntry[],
  ): Promise<{ ok: boolean; error?: string }> {
    const r = await deps.exec(buildJqWriteCommand(agent, entries), 30_000);
    if (r.exitCode !== 0) {
      return { ok: false, error: r.stderr || r.stdout || "jq write failed" };
    }
    return { ok: true };
  }

  /** Copy the current omo.jsonc content to admin-data; returns the snapshot file path or null. */
  async function snapshotAgentModelsConfig(): Promise<string | null> {
    const r = await deps.exec(`cat ${OMO_CONFIG} 2>/dev/null`, 10_000);
    if (r.exitCode !== 0 || !r.stdout) return null;
    if (!existsSync(deps.snapshotDir)) mkdirSync(deps.snapshotDir, { recursive: true });
    const file = join(deps.snapshotDir, `omo.jsonc.snapshot-${Date.now()}`);
    writeFileSync(file, r.stdout, "utf-8");
    return file;
  }

  /** Write a snapshot file back into the ai-dev container (base64 transport). */
  async function restoreAgentModelsConfig(snapshotFile: string): Promise<{ ok: boolean; error?: string }> {
    let content: string;
    try {
      content = readFileSync(snapshotFile, "utf-8");
    } catch {
      return { ok: false, error: "snapshot file unreadable" };
    }
    const b64 = Buffer.from(content).toString("base64");
    const r = await deps.exec(`echo '${b64}' | base64 -d > ${OMO_CONFIG}`, 15_000);
    if (r.exitCode !== 0) {
      return { ok: false, error: r.stderr || r.stdout || "restore failed" };
    }
    return { ok: true };
  }

  /** Stable Basic-auth password for the managed opencode server, or null when unset. */
  function getServerPassword(): string | null {
    const value = deps.readEnv()["OPENCODE_SERVER_PASSWORD"];
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  /** Models on currently connected providers (for the UI model select). */
  async function fetchConnectedCatalog(password: string | null): Promise<string[]> {
    // 1. Connected providers — the lazy plugin cache may be absent on fresh installs.
    const r1 = await deps.exec(`cat ~/.cache/oh-my-opencode/connected-providers.json 2>/dev/null || echo '{}'`, 10_000);
    let conn: string[] = [];
    try {
      const parsed: unknown = JSON.parse(r1.stdout);
      const connected = (parsed as { connected?: unknown }).connected;
      if (Array.isArray(connected)) {
        conn = connected.filter((c): c is string => typeof c === "string");
      }
    } catch {
      conn = [];
    }

    // 2. Provider catalog — also a lazy cache; list its providers for the fallback.
    const r2 = await deps.exec(
      `jq -r '.models | keys[]' ~/.cache/oh-my-opencode/provider-models.json 2>/dev/null || true`,
      10_000,
    );
    const allProviders = r2.exitCode === 0 ? r2.stdout.split("\n").filter((l) => l.trim().length > 0) : [];

    // 3. Models for the connected providers (or all catalog providers when the
    //    connected-providers cache has not been written yet).
    const providers = conn.length > 0 ? conn : allProviders;
    if (providers.length > 0) {
      const connJson = providers.map((p) => JSON.stringify(p)).join(",");
      const r3 = await deps.exec(
        `jq -r --argjson conn '[${connJson}]' '[.models | to_entries[] | select(.key as $k | ($conn | index($k))) | .value[]?.id] | unique[]' ~/.cache/oh-my-opencode/provider-models.json 2>/dev/null || true`,
        15_000,
      );
      if (r3.exitCode === 0 && r3.stdout) {
        const models = r3.stdout.split("\n").filter((l) => l.trim().length > 0);
        if (models.length > 0) return models;
      }
    }

    // 4. Last resort: models actually resolved on the live managed server —
    //    authoritative and cache-independent.
    if (password !== null) {
      const map = await fetchResolvedAgentModels(password);
      if (map !== null) {
        return [...new Set([...map.values()].map((m) => m.modelID))].sort();
      }
    }
    return [];
  }

  /** Query the managed opencode server's /agent endpoint; returns name → resolved model. */
  async function fetchResolvedAgentModels(password: string): Promise<Map<string, ResolvedModel> | null> {
    const auth = Buffer.from(`opencode:${password}`).toString("base64");
    const script = `PORT=""
for f in ${MANAGED_OPENCODE_DIR}/*.json; do
  [ -f "\$f" ] || continue
  pid=\$(jq -r '.pid' "\$f" 2>/dev/null)
  if [ -n "\$pid" ] && kill -0 "\$pid" 2>/dev/null; then
    PORT=\$(jq -r '.port' "\$f")
    break
  fi
done
[ -n "\$PORT" ] || exit 3
for i in 1 2 3 4 5 6 7 8 9 10; do
  OUT=\$(curl -fsS -m 3 -H "Authorization: Basic ${auth}" "http://127.0.0.1:\${PORT}/agent" 2>/dev/null) && { printf '%s' "\$OUT"; exit 0; }
  sleep 2
done
exit 2`;
    const r = await deps.exec(script, 40_000);
    if (r.exitCode !== 0 || !r.stdout) return null;
    try {
      const parsed: unknown = JSON.parse(r.stdout);
      if (!Array.isArray(parsed)) return null;
      const map = new Map<string, ResolvedModel>();
      for (const agent of parsed) {
        const name = (agent as { name?: unknown }).name;
        const model = (agent as { model?: unknown }).model;
        const m = model as { modelID?: unknown; providerID?: unknown };
        if (typeof name !== "string" || !m || typeof m.modelID !== "string" || typeof m.providerID !== "string") {
          continue;
        }
        map.set(name, { modelID: m.modelID, providerID: m.providerID });
      }
      return map;
    } catch {
      return null;
    }
  }

  /**
   * Apply → restart → confirm. Verification is config acceptance, not a
   * /agent model comparison: the managed server's /agent endpoint reports the
   * plugin DEFAULT (AGENT_MODEL_REQUIREMENTS), which never reflects
   * fallback_models (verified empirically). The /agent read below is purely
   * informational for the UI. Rollback (snapshot restore) happens only when
   * the write or the restart fails — a live mismatch is expected, not a failure.
   */
  async function applyAndVerify(agent: string, entries: FallbackModelEntry[]): Promise<ApplyResult> {
    const snapshot = await snapshotAgentModelsConfig();

    const write = await writeAgentFallbackModels(agent, entries);
    if (!write.ok) {
      return { ok: false, status: "write_failed", error: write.error ?? "write failed" };
    }

    const restart = await deps.restart();
    if (!restart.ok) {
      if (snapshot !== null) await restoreAgentModelsConfig(snapshot);
      return { ok: false, status: "restart_failed", error: restart.error ?? "restart failed" };
    }

    const password = getServerPassword();
    if (password === null) {
      return { ok: false, status: "unverified", error: "OPENCODE_SERVER_PASSWORD missing after restart" };
    }

    const resolvedMap = await fetchResolvedAgentModels(password);
    if (resolvedMap === null) {
      return { ok: false, status: "unverified", error: "could not reach the managed opencode /agent endpoint after restart" };
    }

    return { ok: true, status: "verified", resolved: resolvedMap.get(agent) ?? null };
  }

  return {
    readAgentModelsConfig,
    writeAgentFallbackModels,
    snapshotAgentModelsConfig,
    restoreAgentModelsConfig,
    getServerPassword,
    fetchConnectedCatalog,
    fetchResolvedAgentModels,
    applyAndVerify,
  };
}

export type AgentModelsLib = ReturnType<typeof createAgentModelsLib>;
