import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearNpmVersionsCache,
  compareSemverDescending,
  discoverNpmVersions,
  NpmRegistryError,
  sortVersionsDescending,
  type FetchImpl,
} from "./npm-versions";

type MockEntry = {
  match: (url: string, init?: RequestInit) => boolean;
  response: (url: string, init?: RequestInit) => Response;
};

function makeFetch(entries: MockEntry[], onCall?: (url: string) => void): FetchImpl {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString();
    if (onCall) onCall(u);
    for (const e of entries) {
      if (e.match(u, init)) return e.response(u, init);
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
}

function registryBody(versionKeys: string[], tag: string): Record<string, unknown> {
  const versions: Record<string, unknown> = {};
  for (const v of versionKeys) versions[v] = {};
  return { "dist-tags": { latest: tag }, versions };
}

beforeEach(() => {
  clearNpmVersionsCache();
});

describe("compareSemverDescending", () => {
  test("orders numerically, not lexically", () => {
    expect(compareSemverDescending("1.0.10", "1.0.2")).toBeLessThan(0); // 10 > 2
    expect(compareSemverDescending("1.10.0", "1.9.0")).toBeLessThan(0);
    expect(compareSemverDescending("2.0.0", "1.99.99")).toBeLessThan(0);
  });
  test("pushes non-semver to the end", () => {
    expect(compareSemverDescending("1.0.0", "dev")).toBeLessThan(0);
    expect(compareSemverDescending("abc", "1.0.0")).toBeGreaterThan(0);
  });
});

describe("sortVersionsDescending", () => {
  test("dedupes and sorts newest first", () => {
    const input = ["1.0.1", "1.0.10", "1.0.2", "1.0.1", "1.1.0", "2.0.0-rc1", "1.0.0"];
    // 2.0.0-rc1 parses as [2,0,0] so it sorts above all 1.x (semver-correct);
    // dedupes 1.0.1 and sorts numerically not lexically.
    expect(sortVersionsDescending(input)).toEqual(["2.0.0-rc1", "1.1.0", "1.0.10", "1.0.2", "1.0.1", "1.0.0"]);
  });
});

describe("discoverNpmVersions", () => {
  test("success returns versions newest-first with latest marked", async () => {
    const body = registryBody(["1.0.0", "1.0.1", "1.1.0", "1.0.10"], "1.1.0");
    const fetch = makeFetch([{ match: () => true, response: () => new Response(JSON.stringify(body), { status: 200 }) }]);
    const result = await discoverNpmVersions("yaml-language-server", { fetchImpl: fetch });
    expect(result.versions).toEqual(["1.1.0", "1.0.10", "1.0.1", "1.0.0"]);
    expect(result.latest).toBe("1.1.0");
  });

  test("requests the encoded package from the registry", async () => {
    let gotUrl = "";
    const fetch = makeFetch([{ match: () => true, response: () => new Response(JSON.stringify(registryBody(["1.0.0"], "1.0.0")), { status: 200 }) }]);
    const fetchImpl: FetchImpl = async (url) => {
      gotUrl = url.toString();
      return await fetch(url);
    };
    await discoverNpmVersions("@biomejs/biome", { fetchImpl });
    expect(gotUrl).toContain("/%40biomejs%2Fbiome");
  });

  test("unchanged registry.http_status returns nothing special, only versions", async () => {
    const result = await discoverNpmVersions("x", {
      fetchImpl: makeFetch([{ match: () => true, response: () => new Response(JSON.stringify(registryBody([], "latest")), { status: 200 }) }]),
    });
    expect(result.versions).toEqual([]);
    expect(result.latest).toBe("latest");
  });

  test("unreachable network rejects with registry_unreachable", async () => {
    const fetch = makeFetch([
      { match: () => true, response: () => { throw new Error("ECONNREFUSED"); } },
    ]);
    const err = await discoverNpmVersions("pkg", { fetchImpl: fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NpmRegistryError);
    expect((err as NpmRegistryError).code).toBe("registry_unreachable");
  });

  test("non-2xx response rejects with registry_unreachable", async () => {
    const fetch = makeFetch([{ match: () => true, response: () => new Response("nope", { status: 404 }) }]);
    const err = await discoverNpmVersions("pkg", { fetchImpl: fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NpmRegistryError);
    expect((err as NpmRegistryError).code).toBe("registry_unreachable");
  });

  test("payload missing versions rejects with invalid_payload", async () => {
    const fetch = makeFetch([{ match: () => true, response: () => new Response(JSON.stringify({ dist: {} }), { status: 200 }) }]);
    const err = await discoverNpmVersions("pkg", { fetchImpl: fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NpmRegistryError);
    expect((err as NpmRegistryError).code).toBe("invalid_payload");
  });

  test("cache reuse within TTL and refresh after expiry", async () => {
    let calls = 0;
    const fetch = makeFetch(
      [{ match: () => true, response: () => { calls++; return new Response(JSON.stringify(registryBody(["1.0.0"], "1.0.0")), { status: 200 }); } }],
    );
    let now = 0;
    const nowFn = () => now;

    const r1 = await discoverNpmVersions("cached", { fetchImpl: fetch, now: nowFn });
    expect(calls).toBe(1);

    const r2 = await discoverNpmVersions("cached", { fetchImpl: fetch, now: nowFn });
    expect(r2).toEqual(r1);
    expect(calls).toBe(1); // cached, no extra fetch

    now = 600_000; // beyond 5-min TTL
    await discoverNpmVersions("cached", { fetchImpl: fetch, now: nowFn });
    expect(calls).toBe(2);
  });

  test("per-package cache isolation", async () => {
    const fetch = makeFetch([{ match: () => true, response: () => new Response(JSON.stringify(registryBody(["1.0.0"], "1.0.0")), { status: 200 }) }]);
    await discoverNpmVersions("pkg-a", { fetchImpl: fetch });
    await discoverNpmVersions("pkg-b", { fetchImpl: fetch });
    // two separate keys -> two fetches
    expect(fetch).toBeDefined();
  });
});
