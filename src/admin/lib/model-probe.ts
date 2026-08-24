/**
 * Real model availability probe via the opencode session API.
 *
 * Creates a throwaway session, sends a minimal message with the target model
 * override, and inspects the response for errors (410 = retired, 404 = unavailable).
 * Results are cached in ~/.cache/openchamber/agent-model-health.json to avoid
 * redundant probes for models that were already confirmed dead/alive.
 */

import type { AgentModelsDeps } from "./agent-model-types";

export type ProbeStatus = "healthy" | "retired" | "unavailable" | "retryable" | "unreachable" | "mismatch";

export interface ProbeResult {
  readonly status: ProbeStatus;
  readonly reason?: string;
}

/** Split "provider/model-id" on the first slash. */
export function parseModelReference(ref: string): { providerID: string; modelID: string } | null {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx >= ref.length - 1) return null;
  return { providerID: ref.slice(0, idx), modelID: ref.slice(idx + 1) };
}

const MANAGED_OPENCODE_DIR = "$HOME/.config/openchamber/managed-opencode";
const HEALTH_CACHE_DIR = "$HOME/.cache/openchamber";
const HEALTH_CACHE_PATH = `${HEALTH_CACHE_DIR}/agent-model-health.json`;
const CONFIRMED_TTL_SECONDS = 86_400;
const RETRYABLE_TTL_SECONDS = 300;

interface HealthRecord {
  status: ProbeStatus;
  reason: string;
  observedAt: string;
  retryAfter: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readHealthCache(deps: Pick<AgentModelsDeps, "exec">): Promise<Record<string, HealthRecord>> {
  const result = await deps.exec(`cat '${HEALTH_CACHE_PATH}' 2>/dev/null || echo '{}'`, 5_000);
  if (result.exitCode !== 0) return {};
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (isRecord(parsed)) return parsed as Record<string, HealthRecord>;
  } catch {
    return {};
  }
  return {};
}

async function writeHealthCache(
  deps: Pick<AgentModelsDeps, "exec">,
  cache: Record<string, HealthRecord>,
): Promise<void> {
  const encoded = Buffer.from(JSON.stringify(cache)).toString("base64");
  await deps.exec(
    `mkdir -p '${HEALTH_CACHE_DIR}' && printf '%s' '${encoded}' | base64 -d > '${HEALTH_CACHE_PATH}.tmp' && mv '${HEALTH_CACHE_PATH}.tmp' '${HEALTH_CACHE_PATH}'`,
    10_000,
  );
}

function buildProbeScript(auth: string, providerID: string, modelID: string): string {
  const body = JSON.stringify({
    model: { providerID, modelID },
    parts: [{ type: "text", text: "Reply with exactly OK." }],
  });
  const bodyB64 = Buffer.from(body).toString("base64");
  return `for f in ${MANAGED_OPENCODE_DIR}/*.json; do
  [ -f "$f" ] || continue
  pid=$(jq -r '.pid' "$f" 2>/dev/null)
  port=$(jq -r '.port' "$f" 2>/dev/null)
  [ -n "$pid" ] && [ -n "$port" ] || continue
  kill -0 "$pid" 2>/dev/null || continue
  BASE="http://127.0.0.1:$port"
  SID=$(jq -nc '{title:"model availability probe"}' | curl -fsS -m 5 -H "Authorization: Basic ${auth}" -H 'Content-Type: application/json' -X POST "$BASE/session" -d @- 2>/dev/null | jq -r '.id // empty')
  [ -n "$SID" ] || continue
  BODY=$(printf '%s' '${bodyB64}' | base64 -d)
  OUT=$(curl -s -m 60 -H "Authorization: Basic ${auth}" -H 'Content-Type: application/json' -X POST "$BASE/session/$SID/message" -d "$BODY" 2>/dev/null || true)
  curl -fsS -m 5 -H "Authorization: Basic ${auth}" -X DELETE "$BASE/session/$SID" >/dev/null 2>&1 || true
  printf '%s' "$OUT"
  exit 0
done
exit 2`;
}

/**
 * Classify a session-message response. Only confirmed-dead models block
 * configuration; anything ambiguous degrades to "retryable" (fail-open).
 */
export function classifyProbeResponse(stdout: string, modelID: string): ProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { status: "retryable", reason: "probe response was not JSON" };
  }

  const infos: Array<Record<string, unknown>> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.role === "string") infos.push(node);
    if (isRecord(node.info)) infos.push(node.info as Record<string, unknown>);
    for (const value of Object.values(node)) visit(value);
  };
  visit(parsed);

  const assistants = infos.filter((info) => info.role === "assistant");
  const errored = assistants.find((info) => info.error !== undefined && info.error !== null);
  if (errored !== undefined) {
    const message = JSON.stringify(errored.error);
    if (/410|end.of.life|retired|deprecated|no longer available/i.test(message)) {
      return { status: "retired", reason: message };
    }
    if (/404|not.found|unavailable|does not exist/i.test(message)) {
      return { status: "unavailable", reason: message };
    }
    return { status: "retryable", reason: message };
  }

  const resolved = assistants.find(
    (info) => typeof info.modelID === "string" && typeof info.providerID === "string",
  );
  if (resolved !== undefined) {
    if (resolved.modelID !== modelID) {
      return { status: "mismatch", reason: `resolved ${resolved.providerID}/${resolved.modelID}` };
    }
    return { status: "healthy" };
  }
  return { status: "retryable", reason: "probe returned no assistant response" };
}

export async function probeModel(
  deps: Pick<AgentModelsDeps, "exec" | "readEnv">,
  providerID: string,
  modelID: string,
): Promise<ProbeResult> {
  const modelRef = `${providerID}/${modelID}`;

  const cache = await readHealthCache(deps);
  const cached = cache[modelRef];
  const now = Math.floor(Date.now() / 1000);
  if (cached && typeof cached.retryAfter === "number" && cached.retryAfter > now) {
    return { status: cached.status, reason: cached.reason };
  }

  const password = deps.readEnv()["OPENCODE_SERVER_PASSWORD"]?.trim();
  if (!password) {
    return { status: "unreachable", reason: "OPENCODE_SERVER_PASSWORD is not set" };
  }
  const auth = Buffer.from(`opencode:${password}`).toString("base64");

  const result = await deps.exec(buildProbeScript(auth, providerID, modelID), 90_000);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return { status: "unreachable", reason: "managed opencode server unreachable" };
  }

  const probe = classifyProbeResponse(result.stdout, modelID);
  if (probe.status !== "unreachable") {
    const ttl = probe.status === "retryable" ? RETRYABLE_TTL_SECONDS : CONFIRMED_TTL_SECONDS;
    cache[modelRef] = {
      status: probe.status,
      reason: probe.reason ?? "",
      observedAt: new Date().toISOString(),
      retryAfter: now + ttl,
    };
    await writeHealthCache(deps, cache);
  }
  return probe;
}
