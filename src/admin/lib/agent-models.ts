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
  type AgentModelsDeps,
  type ApplyResult,
  type FallbackModelEntry,
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
