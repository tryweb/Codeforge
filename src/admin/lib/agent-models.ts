import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildJqWriteCommand,
  displayNameToKey,
  parseAgentModelsConfig,
  validateFallbackModels,
} from "./agent-model-config";
import { createAgentModelLiveClient } from "./agent-model-live";
import {
  CONFIGURABLE_NATIVE_AGENTS,
  OMO_CONFIG,
  VARIANTS,
  type AgentModelConfig,
  type AgentModelEntry,
  type AgentModelsDeps,
  type ApplyResult,
  type FallbackModelEntry,
  type ResolvedModel,
} from "./agent-model-types";
import { execInAiDev } from "./docker";
import { readEnvFile } from "./env";
import { restartAiDev } from "./restart-ai-dev";

export {
  buildJqWriteCommand,
  CONFIGURABLE_NATIVE_AGENTS,
  displayNameToKey,
  OMO_CONFIG,
  validateFallbackModels,
  VARIANTS,
};
export type {
  AgentModelConfig,
  AgentModelEntry,
  AgentModelsDeps,
  ApplyResult,
  FallbackModelEntry,
  ResolvedModel,
} from "./agent-model-types";

export const REAL_DEPS: AgentModelsDeps = {
  exec: execInAiDev,
  restart: restartAiDev,
  readEnv: readEnvFile,
  snapshotDir: "/opt/ai-engkit/admin-data",
};

export function createAgentModelsLib(deps: AgentModelsDeps = REAL_DEPS) {
  const live = createAgentModelLiveClient(deps);

  async function readAgentModelsConfig(): Promise<Record<string, AgentModelConfig>> {
    const result = await deps.exec(`jq -c '.agents // {}' ${OMO_CONFIG} 2>/dev/null || echo '{}'`, 10_000);
    return result.exitCode === 0 ? parseAgentModelsConfig(result.stdout) : {};
  }

  async function writeAgentFallbackModels(
    agent: string,
    entries: readonly FallbackModelEntry[],
  ): Promise<{ readonly ok: boolean; readonly error?: string }> {
    const result = await deps.exec(buildJqWriteCommand(agent, entries), 30_000);
    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr || result.stdout || "jq write failed" };
    }
    return { ok: true };
  }

  async function snapshotAgentModelsConfig(): Promise<string | null> {
    const result = await deps.exec(`cat ${OMO_CONFIG} 2>/dev/null`, 10_000);
    if (result.exitCode !== 0 || !result.stdout) return null;
    try {
      if (!existsSync(deps.snapshotDir)) mkdirSync(deps.snapshotDir, { recursive: true });
      const file = join(deps.snapshotDir, `omo.jsonc.snapshot-${Date.now()}`);
      writeFileSync(file, result.stdout, "utf-8");
      return file;
    } catch {
      return null;
    }
  }

  async function restoreAgentModelsConfig(snapshotFile: string): Promise<{ readonly ok: boolean; readonly error?: string }> {
    let content: string;
    try {
      content = readFileSync(snapshotFile, "utf-8");
    } catch {
      return { ok: false, error: "snapshot file unreadable" };
    }
    const encoded = Buffer.from(content).toString("base64");
    const result = await deps.exec(`echo '${encoded}' | base64 -d > ${OMO_CONFIG}`, 15_000);
    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr || result.stdout || "restore failed" };
    }
    return { ok: true };
  }

  function getServerPassword(): string | null {
    const trimmed = deps.readEnv()["OPENCODE_SERVER_PASSWORD"]?.trim();
    return trimmed ? trimmed : null;
  }

  async function applyAndVerify(agent: string, entries: readonly FallbackModelEntry[]): Promise<ApplyResult> {
    const snapshot = await snapshotAgentModelsConfig();
    if (snapshot === null) {
      return { ok: false, status: "write_failed", error: "could not snapshot ~/.omo/omo.jsonc before applying the model" };
    }
    const write = await writeAgentFallbackModels(agent, entries);
    if (!write.ok) {
      return { ok: false, status: "write_failed", error: write.error ?? "write failed" };
    }

    const restart = await deps.restart();
    if (!restart.ok) {
      const rollback = await restoreAgentModelsConfig(snapshot);
      if (!rollback.ok) {
        return { ok: false, status: "rollback_failed", error: `${restart.error ?? "restart failed"}; ${rollback.error ?? "rollback failed"}` };
      }
      return { ok: false, status: "restart_failed", error: restart.error ?? "restart failed" };
    }

    const password = getServerPassword();
    if (password === null) {
      return { ok: false, status: "unverified", error: "OPENCODE_SERVER_PASSWORD missing after restart" };
    }
    const resolvedMap = await live.fetchResolvedAgentModels(password);
    if (resolvedMap === null) {
      return { ok: false, status: "unverified", error: "could not reach the managed opencode /agent endpoint after restart" };
    }

    const resolved = resolvedMap.get(agent)
      ?? [...resolvedMap.entries()].find(([name]) => displayNameToKey(name, new Set([agent])) === agent)?.[1]
      ?? null;
    if (resolved === null) {
      return { ok: false, status: "unverified", error: `live agent ${agent} did not resolve a model after restart` };
    }
    const configured = entries[0]?.model;
    if (configured !== undefined && `${resolved.providerID}/${resolved.modelID}` !== configured) {
      const actual = `${resolved.providerID}/${resolved.modelID}`;
      return {
        ok: false,
        status: "runtime_mismatch",
        configured,
        resolved,
        error: `Configured model ${configured} was persisted, but the live agent resolved ${actual}`,
      };
    }
    return { ok: true, status: entries.length === 0 ? "cleared" : "verified", resolved };
  }

  return {
    readAgentModelsConfig,
    writeAgentFallbackModels,
    snapshotAgentModelsConfig,
    restoreAgentModelsConfig,
    getServerPassword,
    fetchConnectedCatalog: live.fetchConnectedCatalog,
    fetchResolvedAgentModels: live.fetchResolvedAgentModels,
    fetchSubagentNames: live.fetchSubagentNames,
    applyAndVerify,
  };
}

export type AgentModelsLib = ReturnType<typeof createAgentModelsLib>;

/** Per-agent view state shared by the admin UI and the center agent protocol. */
export type AgentModelsViewState = {
  agents: AgentModelEntry[];
  catalog: string[];
  hasPassword: boolean;
  catalogAvailable: boolean;
};

/** Merge configured agents with live /agent names into per-agent view entries. */
export async function collectAgentModelState(
  lib: AgentModelsLib,
  password: string | null,
): Promise<AgentModelsViewState> {
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

  return {
    agents,
    catalog: [...catalog],
    hasPassword: password !== null,
    catalogAvailable: catalog.length > 0,
  };
}
