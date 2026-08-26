import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { displayNameToKey } from "./agent-model-config";
import { createAgentModelsLib, type AgentModelsLib } from "./agent-models";
import { parseModelReference, probeModel, pruneStaleProbeCacheForProvider, type ProbeResult } from "./model-probe";
import {
  CONFIGURABLE_NATIVE_AGENTS,
  MANAGED_OPENCODE_DIR,
  type AgentModelsDeps,
  type ApplyResult,
  type FallbackModelEntry,
  type ResolvedModel,
} from "./agent-model-types";

// Maximum distinct provider/model probes permitted during one reconciliation.
const MAX_PROBES = 12;
// Maximum concurrent probes supported by the policy; probes are batched at this ceiling.
const PROBE_CONCURRENCY = 3;
// The lock directory is created atomically, so its existence is the lock state.
const LOCK_SUFFIX = ".cache/openchamber/agent-model-reconcile.lock";
let pending = false;
let active = false;

export type ReconcileSummary = {
  readonly changed: number;
  readonly applied: number;
  readonly failed: number;
  readonly agents: readonly string[];
};

type Capability = {
  readonly reasoning?: boolean;
  readonly toolcall?: boolean;
  readonly attachment?: boolean;
  readonly input?: Record<string, unknown>;
};

type CapabilityCatalog = ReadonlyMap<string, Capability>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameEntries(left: readonly FallbackModelEntry[], right: readonly FallbackModelEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other?.model === entry.model && other?.variant === entry.variant;
  });
}

function resultForNoop(entries: readonly FallbackModelEntry[]): ApplyResult {
  const resolved = entries[0]?.model;
  if (resolved === undefined) return { ok: true, status: "cleared", resolved: null, requestVerified: null };
  const parsed = parseModelReference(resolved);
  return {
    ok: true,
    status: "verified",
    resolved: parsed === null ? null : { providerID: parsed.providerID, modelID: parsed.modelID },
    requestVerified: null,
  };
}

function category(agent: string): "reasoning" | "exploration" | "general" {
  if (["plan", "oracle", "metis", "momus"].includes(agent)) return "reasoning";
  if (["explore", "librarian"].includes(agent)) return "exploration";
  return "general";
}

function score(agent: string, capability: Capability | undefined): number {
  if (capability === undefined) return 0;
  const inputCount = capability.input === undefined ? 0 : Object.keys(capability.input).length;
  switch (category(agent)) {
    case "reasoning":
      return (capability.reasoning === true ? 100 : 0) + (capability.toolcall === true ? 20 : 0) + inputCount;
    case "exploration":
      return (capability.toolcall === true ? 100 : 0) + (capability.reasoning === false ? 20 : 0) + (capability.attachment === true ? 10 : 0);
    case "general":
      return (capability.toolcall === true ? 100 : 0) + (capability.attachment === true ? 20 : 0) + (capability.reasoning === true ? 10 : 0);
    default:
      return 0;
  }
}

function parseCapabilities(stdout: string): CapabilityCatalog {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { return new Map(); }
  if (!isRecord(parsed) || !Array.isArray(parsed.all)) return new Map();
  const capabilities = new Map<string, Capability>();
  for (const provider of parsed.all) {
    if (!isRecord(provider) || typeof provider.id !== "string" || !isRecord(provider.models)) continue;
    for (const [model, value] of Object.entries(provider.models)) {
      if (!isRecord(value) || !isRecord(value.capabilities)) continue;
      const raw = value.capabilities;
      const input = isRecord(raw.input) ? raw.input : undefined;
      capabilities.set(`${provider.id}/${model}`, {
        reasoning: typeof raw.reasoning === "boolean" ? raw.reasoning : undefined,
        toolcall: typeof raw.toolcall === "boolean" ? raw.toolcall : undefined,
        attachment: typeof raw.attachment === "boolean" ? raw.attachment : undefined,
        ...(input === undefined ? {} : { input }),
      });
    }
  }
  return capabilities;
}

async function fetchCapabilityCatalog(deps: AgentModelsDeps, password: string): Promise<CapabilityCatalog> {
  const auth = Buffer.from(`opencode:${password}`).toString("base64");
  const managedDir = MANAGED_OPENCODE_DIR;
  const script = `for f in ${managedDir}/*.json; do
  [ -f "\$f" ] || continue
  pid=\$(jq -r '.pid' "\$f" 2>/dev/null); port=\$(jq -r '.port' "\$f" 2>/dev/null)
  [ -n "\$pid" ] && [ -n "\$port" ] || continue; kill -0 "\$pid" 2>/dev/null || continue
  curl -fsS -m 3 -H "Authorization: Basic ${auth}" "http://127.0.0.1:\${port}/provider" 2>/dev/null && exit 0
done
exit 2`;
  const result = await deps.exec(script, 90_000);
  return result.exitCode === 0 ? parseCapabilities(result.stdout) : new Map();
}

export function createAgentModelReconciler(deps: AgentModelsDeps) {
  const lib: AgentModelsLib = createAgentModelsLib(deps);
  const lockPath = join(process.env.HOME ?? homedir(), LOCK_SUFFIX);
  const probes = new Map<string, ProbeResult>();
  let probeCount = 0;

  async function probe(ref: string): Promise<ProbeResult> {
    const cached = probes.get(ref);
    if (cached !== undefined) return cached;
    if (probeCount >= MAX_PROBES) return { status: "retryable", reason: "probe budget exhausted" };
    const parsed = parseModelReference(ref);
    if (parsed === null) return { status: "mismatch", reason: "invalid model reference" };
    probeCount += 1;
    const result = await probeModel(deps, parsed.providerID, parsed.modelID);
    probes.set(ref, result);
    return result;
  }

  async function namesAndResolved(
    password: string,
    config: Readonly<Record<string, { readonly models?: readonly FallbackModelEntry[] }>>,
  ): Promise<{ readonly names: readonly string[]; readonly resolved: ReadonlyMap<string, ResolvedModel> }> {
    const [names, resolvedMap] = await Promise.all([
      lib.fetchSubagentNames(password),
      lib.fetchResolvedAgentModels(password),
    ]);
    const knownKeys = new Set(Object.keys(config));
    const configurable = new Set<string>();
    for (const name of names) {
      const key = displayNameToKey(name, knownKeys) ?? name.toLowerCase();
      if (knownKeys.has(key) || (CONFIGURABLE_NATIVE_AGENTS as readonly string[]).includes(key)) configurable.add(key);
    }
    const mapped = new Map<string, ResolvedModel>();
    for (const [name, model] of resolvedMap ?? []) {
      const key = displayNameToKey(name, knownKeys) ?? name.toLowerCase();
      if (!mapped.has(key)) mapped.set(key, model);
    }
    return { names: [...configurable].sort(), resolved: mapped };
  }

  async function runOnce(): Promise<ReconcileSummary> {
    const password = lib.getServerPassword();
    if (password === null) return { changed: 0, applied: 0, failed: 0, agents: [] };
    const config = await lib.readAgentModelsConfig();
    const [snapshot, state] = await Promise.all([
      lib.fetchProviderSnapshot(password),
      namesAndResolved(password, config),
    ]);
    await Promise.all(snapshot.connectedProviders.map((providerID) => pruneStaleProbeCacheForProvider(deps, providerID)));
    const capabilities = await fetchCapabilityCatalog(deps, password);
    const connected = new Set(snapshot.connectedProviders);
    const changed: Array<readonly [string, readonly FallbackModelEntry[]]> = [];
    const selectCandidate = async (agent: string): Promise<readonly FallbackModelEntry[] | null> => {
      const candidates = snapshot.catalog
        .filter((ref) => parseModelReference(ref) !== null)
        .sort((left, right) => score(agent, capabilities.get(right)) - score(agent, capabilities.get(left)) || left.localeCompare(right));
      for (let offset = 0; offset < candidates.length; offset += PROBE_CONCURRENCY) {
        const batch = candidates.slice(offset, offset + PROBE_CONCURRENCY);
        const results = await Promise.all(batch.map((ref) => probe(ref)));
        const healthyIndex = results.findIndex((result) => result.status === "healthy");
        const selected = healthyIndex < 0 ? undefined : batch[healthyIndex];
        if (selected !== undefined) return [{ model: selected }];
      }
      return null;
    };
    for (const agent of state.names) {
      const configured = config[agent]?.models ?? [];
      const primary = configured[0];
      let desired: readonly FallbackModelEntry[] | null = null;
      if (primary !== undefined) {
        const parsed = parseModelReference(primary.model);
        const status = parsed === null || !connected.has(parsed.providerID) ? null : await probe(primary.model);
        if (status?.status === "healthy" || (status !== null && !["unavailable", "retired"].includes(status.status))) desired = [primary];
        if (desired === null) desired = await selectCandidate(agent);
      } else {
        const resolved = state.resolved.get(agent);
        const resolvedRef = resolved === undefined ? null : `${resolved.providerID}/${resolved.modelID}`;
        if (resolved !== undefined && resolvedRef !== null && connected.has(resolved.providerID)) {
          const status = await probe(resolvedRef);
          if (status.status === "healthy" || !["unavailable", "retired"].includes(status.status)) desired = [];
        }
        if (desired === null) {
          desired = await selectCandidate(agent);
        }
      }
      if (desired !== null && !sameEntries(configured, desired)) changed.push([agent, desired]);
    }
    let failed = 0;
    for (const [agent, entries] of changed) {
      const result = await lib.applyAndVerify(agent, entries);
      if (!result.ok) failed += 1;
    }
    return { changed: changed.length, applied: changed.length - failed, failed, agents: changed.map(([agent]) => agent) };
  }

  async function withLock<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    if (active) { pending = true; return fallback; }
    try {
      mkdirSync(dirname(lockPath), { recursive: true });
      mkdirSync(lockPath, { recursive: false });
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") { pending = true; return fallback; }
      throw error;
    }
    active = true;
    try { return await work(); } finally {
      active = false;
      rmSync(lockPath, { recursive: true, force: true });
    }
  }

  async function reconcileAll(): Promise<ReconcileSummary> {
    let summary: ReconcileSummary = { changed: 0, applied: 0, failed: 0, agents: [] };
    do {
      pending = false;
      probes.clear();
      probeCount = 0;
      let didRun = false;
      summary = await withLock(async () => { didRun = true; return runOnce(); }, summary);
      if (!didRun) return summary;
    } while (pending && !active);
    return summary;
  }

  async function applyAgent(agent: string, entries: readonly FallbackModelEntry[]): Promise<ApplyResult> {
    return withLock(async () => {
      const config = await lib.readAgentModelsConfig();
      const current = config[agent]?.models ?? [];
      return sameEntries(current, entries) ? resultForNoop(entries) : lib.applyAndVerify(agent, entries);
    }, resultForNoop(entries));
  }

  return { reconcileAll, applyAgent };
}
