import { isRecord } from "./agent-model-config";
import {
  MANAGED_OPENCODE_DIR,
  type AgentModelsDeps,
  type ResolvedModel,
} from "./agent-model-types";

function buildAgentFetchScript(auth: string): string {
  return `for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  for f in ${MANAGED_OPENCODE_DIR}/*.json; do
    [ -f "\$f" ] || continue
    pid=\$(jq -r '.pid' "\$f" 2>/dev/null)
    port=\$(jq -r '.port' "\$f" 2>/dev/null)
    [ -n "\$pid" ] && [ -n "\$port" ] || continue
    kill -0 "\$pid" 2>/dev/null || continue
    OUT=\$(curl -fsS -m 3 -H "Authorization: Basic ${auth}" "http://127.0.0.1:\${port}/agent" 2>/dev/null) && { printf '%s' "\$OUT"; exit 0; }
  done
  sleep 1
done
exit 2`;
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
    const connectedResult = await deps.exec(
      `cat ~/.cache/oh-my-opencode/connected-providers.json 2>/dev/null || echo '{}'`,
      10_000,
    );
    let connected: readonly string[] = [];
    try {
      const parsed: unknown = JSON.parse(connectedResult.stdout);
      if (isRecord(parsed) && Array.isArray(parsed.connected)) {
        connected = parsed.connected.filter((provider): provider is string => typeof provider === "string");
      }
    } catch {
      connected = [];
    }

    const providersResult = await deps.exec(
      `jq -r '.models | keys[]' ~/.cache/oh-my-opencode/provider-models.json 2>/dev/null || true`,
      10_000,
    );
    const allProviders = providersResult.exitCode === 0
      ? providersResult.stdout.split("\n").filter((line) => line.trim().length > 0)
      : [];
    const providers = connected.length > 0 ? connected : allProviders;

    if (providers.length > 0) {
      const providerJson = providers.map((provider) => JSON.stringify(provider)).join(",");
      const catalogResult = await deps.exec(
        `jq -r --argjson conn '[${providerJson}]' '[.models | to_entries[] | select(.key as $k | ($conn | index($k))) | .key as $provider | .value[]? | select(type == "object" and (.id | type == "string")) | "\\($provider)/\\(.id)"] | unique[]' ~/.cache/oh-my-opencode/provider-models.json 2>/dev/null || true`,
        15_000,
      );
      if (catalogResult.exitCode === 0 && catalogResult.stdout) {
        const catalog = catalogResult.stdout.split("\n").filter((line) => line.trim().length > 0);
        if (catalog.length > 0) return catalog;
      }
    }

    if (password !== null) {
      const resolved = await fetchResolvedAgentModels(password);
      if (resolved !== null) {
        return [...new Set([...resolved.values()].map((model) => `${model.providerID}/${model.modelID}`))].sort();
      }
    }
    return [];
  }

  return { fetchConnectedCatalog, fetchResolvedAgentModels, fetchSubagentNames };
}
