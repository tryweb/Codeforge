export const MODELS_DEV_URL = "https://models.dev/api.json" as const;
export const METADATA_TIMEOUT_MS = 3000 as const;
export const FREE_FRESH_TTL_MS = 3600000 as const;
export const OTHER_USABLE_TTL_MS = 21600000 as const;
const MAX_METADATA_BYTES = 16_000_000;

export type SourceStatus = "fresh" | "stale" | "unavailable";
export type WarningCode = "metadata_unavailable" | "stale_metadata" | "incomplete_metadata";
export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface NormalizedModelMetadata {
  readonly providerId: string;
  readonly modelId: string;
  readonly reference: string;
  readonly inputPrice: number | null;
  readonly outputPrice: number | null;
  readonly contextLimit: number | null;
  readonly outputLimit: number | null;
  readonly reasoning: boolean | null;
  readonly toolCall: boolean | null;
  readonly structuredOutput: boolean | null;
  readonly deprecated: boolean;
  readonly benchmarkScore: number | null;
  readonly fetchedAt: number;
}

export interface ModelMetadataResult {
  readonly sourceStatus: SourceStatus;
  readonly sourceAgeMs: number | null;
  readonly warnings: readonly WarningCode[];
  readonly models: ReadonlyMap<string, NormalizedModelMetadata>;
  readonly fetchedAt: number | null;
}

export interface MetadataClientOptions {
  readonly fetchImpl?: FetchImpl;
  readonly now?: () => number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function asPrice(v: unknown): number | null {
  return isFiniteNum(v) && v >= 0 ? v : null;
}
function asLimit(v: unknown): number | null {
  return isFiniteNum(v) && Number.isInteger(v) && v > 0 ? v : null;
}
function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function numFrom(o: unknown, keys: string[]): number | null {
  if (!isRecord(o)) return null;
  for (const k of keys) {
    const v = o[k];
    if (isFiniteNum(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
function boolFrom(o: unknown, keys: string[]): boolean | null {
  if (!isRecord(o)) return null;
  for (const k of keys) if (k in o && typeof o[k] === "boolean") return o[k] as boolean;
  return null;
}

function normalizeOne(providerId: string, modelId: string, raw: unknown, fetchedAt: number): NormalizedModelMetadata | null {
  if (!isRecord(raw)) return null;
  let inputPrice: number | null = null;
  let outputPrice: number | null = null;
  const cost = raw["cost"];
  if (isRecord(cost)) {
    const ip = numFrom(cost, ["input", "inputPrice", "prompt"]);
    const op = numFrom(cost, ["output", "outputPrice", "completion"]);
    if (ip !== null) inputPrice = asPrice(ip);
    if (op !== null) outputPrice = asPrice(op);
  }
  if (inputPrice === null && outputPrice === null) {
    const pricing = raw["pricing"];
    if (isRecord(pricing)) {
      const ip = numFrom(pricing, ["input", "prompt"]);
      const op = numFrom(pricing, ["output", "completion"]);
      if (ip !== null) inputPrice = asPrice(ip);
      if (op !== null) outputPrice = asPrice(op);
    }
  }
  if (inputPrice === null) {
    const ip = numFrom(raw, ["inputPrice", "input_price"]);
    if (ip !== null) inputPrice = asPrice(ip);
  }
  if (outputPrice === null) {
    const op = numFrom(raw, ["outputPrice", "output_price"]);
    if (op !== null) outputPrice = asPrice(op);
  }
  let contextLimit: number | null = null;
  let outputLimit: number | null = null;
  const limit = raw["limit"];
  if (isRecord(limit)) {
    const cl = numFrom(limit, ["context", "context_length", "max_input_tokens"]);
    const ol = numFrom(limit, ["output", "output_length", "max_output_tokens"]);
    if (cl !== null) contextLimit = asLimit(cl);
    if (ol !== null) outputLimit = asLimit(ol);
  }
  if (contextLimit === null) {
    const cl = numFrom(raw, ["contextLimit", "context_length", "max_context_length"]);
    if (cl !== null) contextLimit = asLimit(cl);
  }
  if (outputLimit === null) {
    const ol = numFrom(raw, ["outputLimit", "output_length", "max_output_tokens"]);
    if (ol !== null) outputLimit = asLimit(ol);
  }
  let reasoning = asBool(raw["reasoning"]);
  let toolCall = asBool(raw["tool_call"] ?? raw["toolCall"] ?? raw["tools"]);
  let structuredOutput = asBool(raw["structured_output"] ?? raw["structuredOutput"]);
  const caps = raw["capabilities"];
  if (isRecord(caps)) {
    if (reasoning === null) reasoning = boolFrom(caps, ["reasoning"]);
    if (toolCall === null) toolCall = boolFrom(caps, ["tool_call", "toolCall", "tools", "function_calling"]);
    if (structuredOutput === null) structuredOutput = boolFrom(caps, ["structured_output", "structuredOutput"]);
  }
  const deprecated = raw["deprecated"] === true || raw["status"] === "deprecated" || raw["lifecycle"] === "deprecated";
  let benchmarkScore: number | null = null;
  for (const c of [raw["benchmark_score"], raw["benchmarkScore"], raw["benchmark"], raw["performance_score"]]) {
    if (isFiniteNum(c)) { benchmarkScore = c; break; }
  }
  if (benchmarkScore === null && isRecord(raw["benchmark"])) {
    const v = numFrom(raw["benchmark"], ["score", "value", "overall"]);
    if (v !== null && isFiniteNum(v)) benchmarkScore = v;
  }
  return {
    providerId, modelId, reference: `${providerId}/${modelId}`,
    inputPrice, outputPrice, contextLimit, outputLimit,
    reasoning, toolCall, structuredOutput,
    deprecated: deprecated === true,
    benchmarkScore, fetchedAt,
  };
}

export function normalizeMetadataPayload(payload: unknown, fetchedAt: number): { models: Map<string, NormalizedModelMetadata>; warnings: WarningCode[]; valid: boolean } {
  if (!isRecord(payload)) return { models: new Map(), warnings: ["metadata_unavailable"], valid: false };
  let providerMap: Record<string, unknown> = payload;
  if (isRecord(payload["providers"])) {
    const prov = payload["providers"];
    if (isRecord(prov)) providerMap = prov as Record<string, unknown>;
  }
  const models = new Map<string, NormalizedModelMetadata>();
  let hasIncomplete = false;
  for (const [providerId, providerRaw] of Object.entries(providerMap)) {
    if (!isRecord(providerRaw)) continue;
    let entries: Record<string, unknown> | null = null;
    if (isRecord(providerRaw["models"])) entries = providerRaw["models"] as Record<string, unknown>;
    else continue;
    for (const [rawId, mRaw] of Object.entries(entries)) {
      const mid = isRecord(mRaw) && typeof mRaw["id"] === "string" && (mRaw["id"] as string).length > 0 ? (mRaw["id"] as string) : rawId;
      const n = normalizeOne(providerId, mid, mRaw, fetchedAt);
      if (!n) continue;
      models.set(n.reference, n);
      if (n.inputPrice === null || n.outputPrice === null || n.reasoning === null || n.toolCall === null) hasIncomplete = true;
    }
  }
  const warnings: WarningCode[] = hasIncomplete ? ["incomplete_metadata"] : [];
  return { models, warnings, valid: true };
}

let cache: { fetchedAt: number; models: Map<string, NormalizedModelMetadata>; warnings: readonly WarningCode[] } | null = null;
export function clearModelMetadataCache(): void { cache = null; }
export function getModelMetadataCache(): { fetchedAt: number; models: ReadonlyMap<string, NormalizedModelMetadata>; warnings: readonly WarningCode[] } | null {
  return cache ? { fetchedAt: cache.fetchedAt, models: new Map(cache.models), warnings: [...cache.warnings] } : null;
}
function unavailable(): ModelMetadataResult {
  return { sourceStatus: "unavailable", sourceAgeMs: null, warnings: ["metadata_unavailable"], models: new Map(), fetchedAt: null };
}
function fromCache(now: number): ModelMetadataResult | null {
  if (!cache) return null;
  const age = now - cache.fetchedAt;
  if (age < 0) return { sourceStatus: "fresh", sourceAgeMs: 0, warnings: [...cache.warnings], models: new Map(cache.models), fetchedAt: cache.fetchedAt };
  if (age <= FREE_FRESH_TTL_MS) return { sourceStatus: "fresh", sourceAgeMs: age, warnings: [...cache.warnings], models: new Map(cache.models), fetchedAt: cache.fetchedAt };
  if (age <= OTHER_USABLE_TTL_MS) {
    const w: WarningCode[] = [...cache.warnings];
    if (!w.includes("stale_metadata")) w.push("stale_metadata");
    return { sourceStatus: "stale", sourceAgeMs: age, warnings: w, models: new Map(cache.models), fetchedAt: cache.fetchedAt };
  }
  return null;
}
async function fetchWithTimeout(fetchImpl: FetchImpl, url: string, timeoutMs: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: c.signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error(`timeout after ${timeoutMs}ms`);
    throw e;
  } finally { clearTimeout(t); }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes) throw new Error("metadata response exceeds size limit");
  }
  if (response.body === null || response.body === undefined) {
    if (response.body === undefined) return JSON.stringify(await response.json());
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("metadata response exceeds size limit");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("metadata response exceeds size limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchModelMetadata(options: MetadataClientOptions = {}): Promise<ModelMetadataResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowFn = options.now ?? (() => Date.now());
  const now = nowFn();
  let err: unknown = null;
  let res: Response | null = null;
  try { res = await fetchWithTimeout(fetchImpl, MODELS_DEV_URL, METADATA_TIMEOUT_MS); } catch (e) { err = e; }
  if (res?.ok) {
    try {
      const json: unknown = JSON.parse(await readBoundedText(res, MAX_METADATA_BYTES));
      if (!isRecord(json)) throw new Error("malformed payload");
      const norm = normalizeMetadataPayload(json, now);
      if (!norm.valid) throw new Error("invalid payload");
      cache = { fetchedAt: now, models: norm.models, warnings: norm.warnings };
      return { sourceStatus: "fresh", sourceAgeMs: 0, warnings: [...norm.warnings], models: new Map(norm.models), fetchedAt: now };
    } catch (error: unknown) {
      err = error instanceof Error ? error : new Error("malformed metadata response");
    }
  } else if (res && !res.ok) err = new Error(`http ${res.status}`);
  const cached = fromCache(now);
  if (err !== null) console.error("[agent-models] model metadata fetch failed:", err.message);
  if (cached) return cached;
  return unavailable();
}
