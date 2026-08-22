import { isRecord } from "./agent-model-config";
import {
  MANAGED_OPENCODE_DIR,
  type AgentModelsDeps,
  type ResolvedModel,
} from "./agent-model-types";

function buildManagedFetchScript(auth: string, endpoint: string): string {
  return `for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  for f in ${MANAGED_OPENCODE_DIR}/*.json; do
    [ -f "\$f" ] || continue
    pid=\$(jq -r '.pid' "\$f" 2>/dev/null)
    port=\$(jq -r '.port' "\$f" 2>/dev/null)
    [ -n "\$pid" ] && [ -n "\$port" ] || continue
    kill -0 "\$pid" 2>/dev/null || continue
    OUT=\$(curl -fsS -m 3 -H "Authorization: Basic ${auth}" "http://127.0.0.1:\${port}${endpoint}" 2>/dev/null) && { printf '%s' "\$OUT"; exit 0; }
  done
  sleep 1
done
exit 2`;
}

function buildAgentFetchScript(auth: string): string {
  return buildManagedFetchScript(auth, "/agent");
}

function parseProviderCatalog(stdout: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.connected) || !Array.isArray(parsed.all)) return [];

  const connected = new Set(parsed.connected.filter((provider): provider is string => typeof provider === "string"));
  const catalog = new Set<string>();
  for (const provider of parsed.all) {
    if (!isRecord(provider) || typeof provider.id !== "string" || !connected.has(provider.id)) continue;
    if (!isRecord(provider.models)) continue;
    for (const model of Object.keys(provider.models)) catalog.add(`${provider.id}/${model}`);
  }
  return [...catalog].sort();
}

function parseCachedCatalog(stdout: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  const catalog = new Set<string>();
  for (const [provider, value] of Object.entries(parsed)) {
    if (!isRecord(value) || !isRecord(value.models)) continue;
    for (const model of Object.keys(value.models)) catalog.add(`${provider}/${model}`);
  }
  return [...catalog].sort();
}

export function createAgentModelLiveClient(deps: Pick<AgentModelsDeps, "exec">) {
  async function fetchResolvedAgentModels(password: string): Promise<Map<string, ResolvedModel> | null> {
    const auth = Buffer.from(`opencode:${password}`).toString("base64");
    const result = await deps.exec(buildAgentFetchScript(auth), 90_000);
    if (result.exitCode !== 0 || !result.stdout) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;

    const models = new Map<string, ResolvedModel>();
    for (const agent of parsed) {
      if (!isRecord(agent) || typeof agent.name !== "string" || !isRecord(agent.model)) continue;
      if (typeof agent.model.modelID !== "string" || typeof agent.model.providerID !== "string") continue;
      models.set(agent.name, {
        modelID: agent.model.modelID,
        providerID: agent.model.providerID,
      });
    }
    return models;
  }

  async function fetchSubagentNames(password: string): Promise<readonly string[]> {
    const auth = Buffer.from(`opencode:${password}`).toString("base64");
    const result = await deps.exec(buildAgentFetchScript(auth), 90_000);
    if (result.exitCode !== 0 || !result.stdout) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((agent): agent is Record<string, unknown> => isRecord(agent))
      .filter((agent) => typeof agent.name === "string" && agent.name.length > 0 && agent.mode === "subagent")
      .map((agent) => agent.name)
      .filter((name): name is string => typeof name === "string");
  }

  async function fetchConnectedCatalog(password: string | null): Promise<readonly string[]> {
    if (password !== null) {
      const auth = Buffer.from(`opencode:${password}`).toString("base64");
      const liveResult = await deps.exec(buildManagedFetchScript(auth, "/provider"), 90_000);
      const liveCatalog = liveResult.exitCode === 0 ? parseProviderCatalog(liveResult.stdout) : [];
      if (liveCatalog.length > 0) return liveCatalog;
    }

    const cacheResult = await deps.exec(`cat ~/.cache/opencode/models.json 2>/dev/null`, 15_000);
    return cacheResult.exitCode === 0 ? parseCachedCatalog(cacheResult.stdout) : [];
  }

  return { fetchConnectedCatalog, fetchResolvedAgentModels, fetchSubagentNames };
}
