/**
 * Formal-release facade over ghcr-oci transport.
 * Handles v1.x.y filtering, numeric sorting, latest-to-formal digest resolution, and short-lived cache.
 */

export {
  GHCR_MANIFEST_ACCEPT,
  GHCR_REGISTRY,
  GHCR_REPO,
  GHCR_TAGS_URL,
  GHCR_TOKEN_URL,
  GhcrError,
  getBearerToken,
  getManifestDigest,
  listAllTags,
} from "./ghcr-oci";

export type { FetchImpl } from "./ghcr-oci";

import { getBearerToken, getManifestDigest, GhcrError, listAllTags, type FetchImpl } from "./ghcr-oci";

const FORMAL_RE = /^v1\.[0-9]+\.[0-9]+$/;
const CACHE_TTL_MS = 300_000;

export interface GhcrDiscoveryResult {
  readonly versions: readonly string[];
  readonly officialVersion: string | null;
  readonly warning: string | null;
}

export interface GhcrClientOptions {
  readonly fetchImpl?: FetchImpl;
  readonly now?: () => number;
}

export interface GhcrClientDeps {
  readonly fetchImpl: FetchImpl;
  readonly now: () => number;
}

function resolveDeps(options: GhcrClientOptions = {}): GhcrClientDeps {
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => Date.now()),
  };
}

export function isFormalReleaseTag(tag: string): boolean {
  return FORMAL_RE.test(tag);
}

export function parseFormalVersion(tag: string): { major: number; minor: number; patch: number } | null {
  if (!FORMAL_RE.test(tag)) return null;
  const parts = tag.slice(1).split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return { major, minor, patch };
}

export function compareFormalDescending(a: string, b: string): number {
  const pa = parseFormalVersion(a);
  const pb = parseFormalVersion(b);
  if (pa === null && pb === null) return a.localeCompare(b);
  if (pa === null) return 1;
  if (pb === null) return -1;
  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  if (pa.patch !== pb.patch) return pb.patch - pa.patch;
  return 0;
}

export function normalizeFormalTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const formal: string[] = [];
  for (const t of tags) {
    if (!isFormalReleaseTag(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    formal.push(t);
  }
  formal.sort(compareFormalDescending);
  return formal;
}

export async function resolveOfficialVersion(
  fetchImpl: FetchImpl,
  token: string,
  formalSorted: readonly string[],
): Promise<{ officialVersion: string | null; warning: string | null }> {
  if (formalSorted.length === 0) {
    return { officialVersion: null, warning: null };
  }

  let latestDigest: string | null;
  try {
    latestDigest = await getManifestDigest(fetchImpl, token, "latest");
  } catch (err) {
    if (err instanceof GhcrError) throw err;
    throw new GhcrError(err instanceof Error ? err.message : String(err), "manifest_fetch_failed");
  }

  if (!latestDigest) {
    return { officialVersion: null, warning: "latest manifest not found" };
  }

  for (const tag of formalSorted) {
    let candidateDigest: string | null;
    try {
      candidateDigest = await getManifestDigest(fetchImpl, token, tag);
    } catch (err) {
      if (err instanceof GhcrError) throw err;
      throw new GhcrError(err instanceof Error ? err.message : String(err), "manifest_fetch_failed");
    }
    if (candidateDigest === null) continue;
    if (candidateDigest === latestDigest) {
      return { officialVersion: tag, warning: null };
    }
  }

  return { officialVersion: null, warning: "latest does not match any formal release" };
}

let cached: { result: GhcrDiscoveryResult; expiresAt: number } | null = null;

export function clearGhcrCache(): void {
  cached = null;
}

export function getGhcrCache(): { result: GhcrDiscoveryResult; expiresAt: number } | null {
  return cached;
}

export async function discoverGhcrVersions(options: GhcrClientOptions = {}): Promise<GhcrDiscoveryResult> {
  const deps = resolveDeps(options);
  const now = deps.now();
  if (cached && now < cached.expiresAt) {
    return cached.result;
  }

  const token = await getBearerToken(deps.fetchImpl);
  const allTags = await listAllTags(deps.fetchImpl, token);
  const formalSorted = normalizeFormalTags(allTags);

  let officialVersion: string | null = null;
  let warning: string | null = null;

  if (formalSorted.length > 0) {
    const resolved = await resolveOfficialVersion(deps.fetchImpl, token, formalSorted);
    officialVersion = resolved.officialVersion;
    warning = resolved.warning;
  }

  const result: GhcrDiscoveryResult = {
    versions: formalSorted,
    officialVersion,
    warning,
  };

  cached = { result, expiresAt: now + CACHE_TTL_MS };
  return result;
}
