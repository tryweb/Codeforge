/**
 * Parse/serialize helpers for the LSP_SERVERS env var — a JSON object
 * `{ "<serverKey>": { "enabled": boolean, "version": string|null } }`.
 * An omitted version means "latest" (unpinned). An absent key falls back to
 * the image-baseline default (all servers disabled / unpinned).
 */
import { LSP_CATALOG, LSP_CATALOG_BY_KEY } from "./lsp-catalog";
import { readEnvFile, upsertEnvVar, deleteEnvVar, type EnvVars } from "./env";

export const LSP_SERVERS_ENV_KEY = "LSP_SERVERS";

export interface LspServerOverride {
  readonly enabled: boolean;
  /** null = latest (unpinned); a string pins the server to that version. */
  readonly version: string | null;
}

export type LspServersOverrides = Readonly<Record<string, LspServerOverride>>;

export interface EffectiveLspServer extends LspServerOverride {
  readonly serverKey: string;
  readonly defaultEnabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverride(value: unknown): LspServerOverride | null {
  if (!isRecord(value)) return null;
  const enabled = value["enabled"];
  const version = value["version"];
  if (typeof enabled !== "boolean") return null;
  if (version !== null && version !== undefined && typeof version !== "string") return null;
  return { enabled, version: version === null || version === undefined ? null : version };
}

/**
 * Parse the LSP_SERVERS JSON string into a typed overrides map. Malformed JSON
 * or unknown keys fall back to defaults (an empty overrides object), never
 * throw — the image baseline is authoritative when the override is absent.
 */
export function parseLspServers(raw: string | null | undefined): LspServersOverrides {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const overrides: Record<string, LspServerOverride> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const entry = parseOverride(value);
    if (entry === null) continue;
    // Legacy alias: the catalog key was "yaml" before it was renamed to
    // match OpenCode's built-in id. Existing .env files keep working.
    const canonicalKey = key === "yaml" ? "yaml-ls" : key;
    if (!LSP_CATALOG_BY_KEY.has(canonicalKey)) continue;
    overrides[canonicalKey] = entry;
  }
  // Built-in-backed servers run even when unmanaged, so an explicit disable
  // cannot express reality: normalize to managed (keeping any pinned version).
  for (const entry of LSP_CATALOG) {
    if (entry.builtinBacked) {
      const current = overrides[entry.serverKey];
      overrides[entry.serverKey] = { enabled: true, version: current?.version ?? null };
    }
  }
  return overrides;
}

export function serializeLspServers(overrides: LspServersOverrides): string {
  const out: Record<string, LspServerOverride> = {};
  for (const key of Object.keys(overrides).sort()) {
    out[key] = overrides[key];
  }
  return JSON.stringify(out);
}

/**
 * Resolve the full effective state for every catalog server by merging user
 * overrides onto the image baseline (default disabled / unpinned).
 */
export function resolveEffectiveConfig(overrides: LspServersOverrides): readonly EffectiveLspServer[] {
  return LSP_CATALOG.map((entry) => {
    const override = overrides[entry.serverKey];
    return {
      serverKey: entry.serverKey,
      enabled: override?.enabled ?? entry.defaultEnabled,
      version: override?.version ?? null,
      defaultEnabled: entry.defaultEnabled,
    };
  });
}

/** Read and parse LSP_SERVERS from a set of env vars (defaults to the .env file). */
export function readLspServers(env: EnvVars = readEnvFile()): LspServersOverrides {
  return parseLspServers(env[LSP_SERVERS_ENV_KEY] ?? null);
}

/**
 * Persist a single server override into the .env LSP_SERVERS value, preserving
 * the other entries.
 */
export function setLspServerOverride(
  serverKey: string,
  override: LspServerOverride,
  env: EnvVars = readEnvFile(),
): void {
  const overrides = { ...readLspServers(env), [serverKey]: override };
  upsertEnvVar(LSP_SERVERS_ENV_KEY, serializeLspServers(overrides));
}

/** Remove a server from LSP_SERVERS (fall back to its baseline default). */
export function clearLspServerOverride(serverKey: string, env: EnvVars = readEnvFile()): void {
  const overrides = { ...readLspServers(env) };
  delete overrides[serverKey];
  if (Object.keys(overrides).length === 0) {
    deleteEnvVar(LSP_SERVERS_ENV_KEY);
    return;
  }
  upsertEnvVar(LSP_SERVERS_ENV_KEY, serializeLspServers(overrides));
}
