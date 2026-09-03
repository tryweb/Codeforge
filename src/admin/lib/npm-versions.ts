/**
 * TTL-cached discovery of published versions for an npm package, read from
 * the public npm registry. Mirrors the ghcr-versions deps-injection + cache
 * pattern so the registry is fully fakeable in tests and the cache is
 * short-lived (registry metadata can change frequently during publish).
 */

const CACHE_TTL_MS = 300_000;
const REGISTRY_BASE = "https://registry.npmjs.org";

export interface NpmVersionDiscoveryResult {
  /** Published versions, newest-first (semver descending). */
  readonly versions: readonly string[];
  /** The `latest` dist-tag when present on the package. */
  readonly latest: string | null;
}

export class NpmRegistryError extends Error {
  readonly code: "registry_unreachable" | "invalid_payload";

  constructor(code: "registry_unreachable" | "invalid_payload", message: string) {
    super(message);
    this.name = "NpmRegistryError";
    this.code = code;
  }
}

export interface FetchImpl {
  (url: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface NpmVersionsClientOptions {
  readonly fetchImpl?: FetchImpl;
  readonly now?: () => number;
  readonly registryBase?: string;
}

interface NpmVersionsClientDeps {
  readonly fetchImpl: FetchImpl;
  readonly now: () => number;
  readonly registryBase: string;
}

function resolveDeps(options: NpmVersionsClientOptions = {}): NpmVersionsClientDeps {
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => Date.now()),
    registryBase: options.registryBase ?? REGISTRY_BASE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compare two semver strings in descending order. Non-semver or malformed
 * strings sort after all well-formed semvers (stable, pushed to the end).
 */
export function compareSemverDescending(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null && pb === null) return a.localeCompare(b);
  if (pa === null) return 1;
  if (pb === null) return -1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i];
  }
  return 0;
}

function parseSemver(version: string): readonly [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (m === null) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return [major, minor, patch];
}

export function sortVersionsDescending(versions: readonly string[]): string[] {
  const seen = new Set<string>();
  const sorted: string[] = [];
  for (const v of versions) {
    if (seen.has(v)) continue;
    seen.add(v);
    sorted.push(v);
  }
  sorted.sort(compareSemverDescending);
  return sorted;
}

const cache = new Map<string, { result: NpmVersionDiscoveryResult; expiresAt: number }>();

export function clearNpmVersionsCache(): void {
  cache.clear();
}

export async function discoverNpmVersions(
  packageName: string,
  options: NpmVersionsClientOptions = {},
): Promise<NpmVersionDiscoveryResult> {
  const deps = resolveDeps(options);
  const now = deps.now();
  const cached = cache.get(packageName);
  if (cached && now < cached.expiresAt) {
    return cached.result;
  }

  let res: Response;
  try {
    res = await deps.fetchImpl(`${deps.registryBase}/${encodeURIComponent(packageName)}`);
  } catch (error: unknown) {
    throw new NpmRegistryError(
      "registry_unreachable",
      `npm registry unreachable for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!res.ok) {
    throw new NpmRegistryError(
      "registry_unreachable",
      `npm registry returned ${res.status} for ${packageName}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (error: unknown) {
    throw new NpmRegistryError(
      "invalid_payload",
      `npm registry returned invalid JSON for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(body) || !isRecord(body.versions)) {
    throw new NpmRegistryError("invalid_payload", `npm registry payload missing versions for ${packageName}`);
  }

  const versionKeys = Object.keys(body.versions);
  const versions = sortVersionsDescending(versionKeys);
  const distTags = isRecord(body["dist-tags"]) ? body["dist-tags"] : {};
  const latestTag = distTags["latest"];
  const latest = typeof latestTag === "string" && latestTag.length > 0 ? latestTag : null;

  const result: NpmVersionDiscoveryResult = { versions, latest };
  cache.set(packageName, { result, expiresAt: now + CACHE_TTL_MS });
  return result;
}
