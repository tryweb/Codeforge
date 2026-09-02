/**
 * Real model availability probe via the opencode session API.
 *
 * Creates a throwaway session, sends a minimal message with the target model
 * override, and inspects the response for errors (410 = retired, 404 = unavailable).
 * Results are cached in ~/.cache/openchamber/agent-model-health.json to avoid
 * redundant probes for models that were already confirmed dead/alive.
 */

import { createHash } from "node:crypto";
import type { AgentModelsDeps } from "./agent-model-types";

export type ProbeStatus = "healthy" | "retired" | "unavailable" | "retryable" | "unreachable" | "mismatch" | "quota_exceeded";

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
const QUOTA_TTL_SECONDS = 900;

interface HealthRecord {
  providerID: string;
  fingerprint: string;
  status: ProbeStatus;
  reason: string;
  observedAt: string;
  retryAfter: number;
}

function hasQuotaMarker(message: string): boolean {
  return /FreeUsageLimitError|free usage exceeded|insufficient_quota|credit_balance_exhausted|credit exhausted|spend_limit_exceeded|quota_exceeded/i.test(message);
}

function shouldRetryTransient(message: string): boolean {
  if (hasQuotaMarker(message)) return false;
  return /429|rate.?limit/i.test(message);
}

function parseRetryAfterDelayMs(message: string): number {
  const match = message.match(/retry-?after[:\s]*([0-9]+)/i);
  if (match) {
    const value = parseInt(match[1], 10);
    if (!Number.isNaN(value)) return Math.min(value, 60) * 1000;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readHealthCache(deps: Pick<AgentModelsDeps, "exec">): Promise<Record<string, HealthRecord>> {
  const result = await deps.exec(`cat "${HEALTH_CACHE_PATH}" 2>/dev/null || echo '{}'`, 5_000);
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
  const scopedCache = Object.fromEntries(
    Object.entries(cache).filter(([key]) => isScopedCacheKey(key)),
  );
  const encoded = Buffer.from(JSON.stringify(scopedCache)).toString("base64");
  await deps.exec(
    `mkdir -p "${HEALTH_CACHE_DIR}" && printf '%s' '${encoded}' | base64 -d > "${HEALTH_CACHE_PATH}.tmp" && chmod 600 "${HEALTH_CACHE_PATH}.tmp" && mv "${HEALTH_CACHE_PATH}.tmp" "${HEALTH_CACHE_PATH}"`,
    10_000,
  );
}

function isScopedCacheKey(key: string): boolean {
  const [providerID, fingerprint, ...modelParts] = key.split("|");
  return providerID !== undefined
    && providerID !== ""
    && fingerprint !== undefined
    && /^[a-f0-9]{64}$/.test(fingerprint)
    && modelParts.length > 0
    && modelParts.join("|") !== "";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function emptyCredentialFingerprint(): string {
  return createHash("sha256").update("").digest("hex");
}

export async function computeProviderCredentialFingerprint(
  deps: Pick<AgentModelsDeps, "exec">,
  providerID: string,
): Promise<string> {
  const providerLiteral = JSON.stringify(providerID);
  const result = await deps.exec(
    `jq -c '.[${providerLiteral}] // empty' "$HOME/.local/share/opencode/auth.json" 2>/dev/null`,
    5_000,
  );
  if (result.exitCode !== 0 || result.stdout.trim() === "") return emptyCredentialFingerprint();
  try {
    const entry: unknown = JSON.parse(result.stdout);
    return createHash("sha256").update(JSON.stringify(canonicalize(entry))).digest("hex");
  } catch {
    return emptyCredentialFingerprint();
  }
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
    if (/FreeUsageLimitError|free usage exceeded|insufficient_quota|credit_balance_exhausted|credit exhausted|spend_limit_exceeded|quota_exceeded/i.test(stdout)) {
      return { status: "quota_exceeded", reason: stdout.slice(0, 2_000) };
    }
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
    if (/FreeUsageLimitError|free usage exceeded|insufficient_quota|credit_balance_exhausted|credit exhausted|spend_limit_exceeded|quota_exceeded/i.test(message)) {
      return { status: "quota_exceeded", reason: message };
    }
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
  const fingerprint = await computeProviderCredentialFingerprint(deps, providerID);
  const cacheKey = `${providerID}|${fingerprint}|${modelRef}`;
  let stalePruned = false;
  for (const key of Object.keys(cache)) {
    if (key !== cacheKey && key.startsWith(`${providerID}|`) && key.endsWith(`|${modelRef}`)) {
      delete cache[key];
      stalePruned = true;
    }
  }
  if (stalePruned) await writeHealthCache(deps, cache);
  const cached = cache[cacheKey];
  const now = Math.floor(Date.now() / 1000);
  if (
    cached
    && cached.providerID === providerID
    && cached.fingerprint === fingerprint
    && typeof cached.retryAfter === "number"
    && cached.retryAfter > now
  ) {
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

  let probe = classifyProbeResponse(result.stdout, modelID);
  if (probe.status === "retryable" && shouldRetryTransient(probe.reason ?? result.stdout)) {
    const delayMs = parseRetryAfterDelayMs(probe.reason ?? result.stdout);
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    const retryResult = await deps.exec(buildProbeScript(auth, providerID, modelID), 90_000);
    if (retryResult.exitCode === 0 && retryResult.stdout.trim()) {
      probe = classifyProbeResponse(retryResult.stdout, modelID);
    }
  }
  if (probe.status !== "unreachable") {
    const ttl = probe.status === "quota_exceeded" ? QUOTA_TTL_SECONDS : probe.status === "retryable" ? RETRYABLE_TTL_SECONDS : CONFIRMED_TTL_SECONDS;
    cache[cacheKey] = {
      providerID,
      fingerprint,
      status: probe.status,
      reason: probe.reason ?? "",
      observedAt: new Date().toISOString(),
      retryAfter: now + ttl,
    };
    await writeHealthCache(deps, cache);
  }
  return probe;
}

export async function invalidateProbeCacheForProvider(
  deps: Pick<AgentModelsDeps, "exec">,
  providerID: string,
): Promise<void> {
  const cache = await readHealthCache(deps);
  for (const key of Object.keys(cache)) {
    if (key.startsWith(`${providerID}|`)) delete cache[key];
  }
  await writeHealthCache(deps, cache);
}

export async function pruneStaleProbeCacheForProvider(
  deps: Pick<AgentModelsDeps, "exec">,
  providerID: string,
): Promise<void> {
  const cache = await readHealthCache(deps);
  const fingerprint = await computeProviderCredentialFingerprint(deps, providerID);
  let changed = false;
  for (const key of Object.keys(cache)) {
    const [keyProvider, keyFingerprint] = key.split("|", 3);
    if (keyProvider === providerID && keyFingerprint !== fingerprint) {
      delete cache[key];
      changed = true;
    }
  }
  if (changed) await writeHealthCache(deps, cache);
}
