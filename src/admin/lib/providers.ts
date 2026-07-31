/**
 * OPENCODE_PROVIDER parsing/validation — the provider definitions env var.
 * The var holds a single-line JSON object whose keys are provider names
 * and values are provider entries (npm, name, options, models, ...).
 */

export const PROVIDER_ENV_KEY = "OPENCODE_PROVIDER";

export interface ProviderEntry {
  npm?: string;
  name?: string;
  options?: Record<string, unknown>;
  models?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ProvidersMap = Record<string, ProviderEntry>;

export type ParseResult =
  | { ok: true; providers: ProvidersMap }
  | { ok: false; error: string };

/** Parse the env value into a provider map. Empty/absent -> empty map. */
export function parseProviders(raw: string | undefined): ParseResult {
  if (!raw || raw.trim().length === 0) return { ok: true, providers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "OPENCODE_PROVIDER must be a JSON object of providers" };
  }
  return { ok: true, providers: parsed as ProvidersMap };
}

/** Validate a single provider entry's shape. */
export function isValidProviderEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (entry.npm !== undefined && typeof entry.npm !== "string") return false;
  if (entry.name !== undefined && typeof entry.name !== "string") return false;
  if (
    entry.options !== undefined &&
    (typeof entry.options !== "object" || entry.options === null || Array.isArray(entry.options))
  ) {
    return false;
  }
  if (
    entry.models !== undefined &&
    (typeof entry.models !== "object" || entry.models === null || Array.isArray(entry.models))
  ) {
    return false;
  }
  return true;
}

/** Get the API key from a provider entry (options.apiKey), if any. */
export function getProviderApiKey(entry: ProviderEntry): string | null {
  const apiKey = entry.options?.apiKey;
  return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : null;
}

/** Serialize the provider map to compact single-line JSON (env-file safe). */
export function serializeProviders(providers: ProvidersMap): string {
  return JSON.stringify(providers);
}
