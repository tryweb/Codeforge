/**
 * GHCR OCI transport — bearer token, paginated tags, manifest digest.
 * No formal-release logic; see ghcr-versions.ts for filtering/sorting.
 */

export const GHCR_REGISTRY = "ghcr.io";
export const GHCR_REPO = "tryweb/ai-engkit";
export const GHCR_TOKEN_URL = `https://${GHCR_REGISTRY}/token?service=${GHCR_REGISTRY}&scope=repository:${GHCR_REPO}:pull`;
export const GHCR_TAGS_URL = `https://${GHCR_REGISTRY}/v2/${GHCR_REPO}/tags/list`;

export const GHCR_MANIFEST_ACCEPT =
  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";

const TAGS_PAGE_SIZE = 100;

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GhcrError extends Error {
  readonly causeCode: string;
  constructor(message: string, causeCode = "ghcr_error") {
    super(message);
    this.name = "GhcrError";
    this.causeCode = causeCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getBearerToken(fetchImpl: FetchImpl): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(GHCR_TOKEN_URL, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new GhcrError(`GHCR token request failed: ${err instanceof Error ? err.message : String(err)}`, "token_fetch_failed");
  }
  if (!res.ok) {
    throw new GhcrError(`GHCR token request failed with ${res.status}`, "token_fetch_failed");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GhcrError("GHCR token response is not JSON", "token_fetch_failed");
  }
  if (!isRecord(body)) {
    throw new GhcrError("GHCR token response malformed", "token_fetch_failed");
  }
  const token = body["token"];
  if (typeof token !== "string" || !token) {
    throw new GhcrError("GHCR token missing", "token_fetch_failed");
  }
  return token;
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (m) return m[1];
  }
  return null;
}

export async function listAllTags(fetchImpl: FetchImpl, token: string): Promise<string[]> {
  const all: string[] = [];
  let url: string | null = `${GHCR_TAGS_URL}?n=${TAGS_PAGE_SIZE}`;
  let last: string | null = null;

  while (url !== null) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (err) {
      throw new GhcrError(`GHCR tags request failed: ${err instanceof Error ? err.message : String(err)}`, "tags_fetch_failed");
    }
    if (!res.ok) {
      throw new GhcrError(`GHCR tags request failed with ${res.status}`, "tags_fetch_failed");
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GhcrError("GHCR tags response is not JSON", "tags_fetch_failed");
    }
    if (!isRecord(body)) {
      throw new GhcrError("GHCR tags response malformed", "tags_fetch_failed");
    }
    const tags = body["tags"];
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (typeof t === "string") all.push(t);
      }
    } else if (tags !== null && tags !== undefined) {
      throw new GhcrError("GHCR tags field malformed", "tags_fetch_failed");
    }

    const linkNext = parseLinkNext(res.headers.get("Link") ?? res.headers.get("link"));
    if (linkNext) {
      url = linkNext.startsWith("http") ? linkNext : `https://${GHCR_REGISTRY}${linkNext}`;
    } else {
      const responseTags = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
      if (responseTags.length === TAGS_PAGE_SIZE) {
        const nextLast = responseTags[responseTags.length - 1];
        if (nextLast === undefined) {
          url = null;
          continue;
        }
        if (nextLast === last) break;
        last = nextLast;
        url = `${GHCR_TAGS_URL}?n=${TAGS_PAGE_SIZE}&last=${encodeURIComponent(nextLast)}`;
      } else {
        url = null;
      }
    }

    if (Array.isArray(tags) && tags.length === 0) break;
  }

  return all;
}

export async function getManifestDigest(fetchImpl: FetchImpl, token: string, tag: string): Promise<string | null> {
  const url = `https://${GHCR_REGISTRY}/v2/${GHCR_REPO}/manifests/${encodeURIComponent(tag)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: GHCR_MANIFEST_ACCEPT,
      },
    });
  } catch (err) {
    throw new GhcrError(`GHCR manifest request failed for ${tag}: ${err instanceof Error ? err.message : String(err)}`, "manifest_fetch_failed");
  }

  if (res.status === 405) {
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: GHCR_MANIFEST_ACCEPT,
        },
      });
    } catch (err) {
      throw new GhcrError(`GHCR manifest request failed for ${tag}: ${err instanceof Error ? err.message : String(err)}`, "manifest_fetch_failed");
    }
  }

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new GhcrError(`GHCR manifest request failed for ${tag} with ${res.status}`, "manifest_fetch_failed");
  }

  const digest = res.headers.get("Docker-Content-Digest") ?? res.headers.get("docker-content-digest");
  if (!digest) return null;
  return digest.trim();
}
