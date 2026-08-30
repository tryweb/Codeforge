import { describe, expect, test, beforeEach } from "bun:test";
import { createUpgradeRoutes, type UpgradeRoutesDeps } from "./upgrade";
import type { GhcrDiscoveryResult } from "../lib/ghcr-versions";
import type { UpgradeEvent } from "../lib/upgrade";

function depsWith(overrides: Partial<UpgradeRoutesDeps> = {}): { deps: UpgradeRoutesDeps; state: { version: string; env: Record<string, string>; discoveryResult: GhcrDiscoveryResult; discoveryError: Error | null; upgradeState: string; writeCalls: Array<Record<string, string>>; runCalls: number } } {
  const state = {
    version: "v1.2.0",
    env: {} as Record<string, string>,
    discoveryResult: { versions: ["v1.2.0", "v1.1.0", "v1.0.1"], officialVersion: "v1.2.0", warning: null } as GhcrDiscoveryResult,
    discoveryError: null as Error | null,
    upgradeState: "idle",
    writeCalls: [] as Array<Record<string, string>>,
    runCalls: 0,
  };

  const deps: UpgradeRoutesDeps = {
    readVersion: () => state.version,
    getState: () => state.upgradeState as ReturnType<UpgradeRoutesDeps["getState"]>,
    getStatus: () => ({ state: state.upgradeState, events: [], current_step: "", progress_pct: 0 }) as ReturnType<UpgradeRoutesDeps["getStatus"]>,
    getEventLog: () => [],
    subscribe: (_subscriber: (event: UpgradeEvent) => void) => () => undefined,
    runUpgrade: async () => {
      state.runCalls++;
      return true;
    },
    readEnvFile: () => ({ ...state.env }),
    writeEnvFile: (vars) => {
      state.writeCalls.push({ ...vars });
      state.env = { ...vars };
    },
    discoverVersions: async () => {
      if (state.discoveryError) throw state.discoveryError;
      return state.discoveryResult;
    },
    ...overrides,
  };

  return { deps, state };
}

describe("GET /api/upgrade/versions", () => {
  test("returns normalized formal list, official_version, current_version, warning", async () => {
    const { deps } = depsWith();
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade/versions");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["versions"]).toEqual(["v1.2.0", "v1.1.0", "v1.0.1"]);
    expect(body["official_version"]).toBe("v1.2.0");
    expect(body["current_version"]).toBe("v1.2.0");
    expect(body["warning"]).toBeNull();
    expect(body["error"]).toBeNull();
  });

  test("dev build returns dev marker without calling discovery", async () => {
    let called = false;
    const { deps } = depsWith({
      readVersion: () => "dev",
      discoverVersions: async () => {
        called = true;
        return { versions: [], officialVersion: null, warning: null };
      },
    });
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade/versions");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["versions"]).toEqual([]);
    expect(body["official_version"]).toBeNull();
    expect(called).toBe(false);
  });

  test("registry failure returns 500 with error", async () => {
    const { deps, state } = depsWith();
    state.discoveryError = new Error("GHCR token failed");
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade/versions");
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body["error"]).toContain("GHCR");
    expect(body["versions"]).toEqual([]);
  });

  test("warning propagated when latest has no alias", async () => {
    const { deps, state } = depsWith();
    state.discoveryResult = { versions: ["v1.1.0"], officialVersion: null, warning: "latest does not match any formal release" };
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade/versions");
    const body = await res.json() as Record<string, unknown>;
    expect(body["official_version"]).toBeNull();
    expect(body["warning"]).toContain("latest");
  });

  test("empty formal set", async () => {
    const { deps, state } = depsWith();
    state.discoveryResult = { versions: [], officialVersion: null, warning: null };
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade/versions");
    const body = await res.json() as Record<string, unknown>;
    expect(body["versions"]).toEqual([]);
    expect(body["official_version"]).toBeNull();
  });
});

describe("POST /api/upgrade", () => {
  test("persists AI_ENGKIT_VERSION before calling runUpgrade with valid formal tag", async () => {
    const { deps, state } = depsWith();
    state.env = { OTHER: "keep" };
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.1.0" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["version"]).toBe("v1.1.0");
    expect(state.writeCalls.length).toBe(1);
    expect(state.writeCalls[0]["AI_ENGKIT_VERSION"]).toBe("v1.1.0");
    expect(state.writeCalls[0]["OTHER"]).toBe("keep");
    expect(state.runCalls).toBe(1);
  });

  test("official target is pinned reproducibly (uses resolved v1.x.y)", async () => {
    const { deps, state } = depsWith();
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.2.0" }),
    });
    expect(res.status).toBe(200);
    expect(state.env["AI_ENGKIT_VERSION"]).toBe("v1.2.0");
  });

  test("rejects malformed version", async () => {
    const { deps, state } = depsWith();
    const app = createUpgradeRoutes(deps);
    for (const bad of ["", "latest", "v1.0", "v2.0.0", "v1.0.0-rc1", "sha-abc"]) {
      const res = await app.request("http://localhost/api/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: bad }),
      });
      expect(res.status).toBe(400);
    }
    expect(state.writeCalls.length).toBe(0);
    expect(state.runCalls).toBe(0);
  });

  test("rejects unknown version not in discovery", async () => {
    const { deps, state } = depsWith();
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.9.9" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>)["error"]).toContain("Unknown");
    expect(state.writeCalls.length).toBe(0);
  });

  test("re-validates against fresh discovery (fails if version not in fresh list)", async () => {
    const { deps, state } = depsWith({
      discoverVersions: async () => ({ versions: ["v1.1.0"], officialVersion: "v1.1.0", warning: null }),
    });
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.2.0" }),
    });
    expect(res.status).toBe(400);
    expect(state.writeCalls.length).toBe(0);
  });

  test("discovery failure returns 502 without changing env", async () => {
    const { deps, state } = depsWith();
    state.discoveryError = new Error("GHCR down");
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.1.0" }),
    });
    expect(res.status).toBe(502);
    expect(state.writeCalls.length).toBe(0);
    expect(state.runCalls).toBe(0);
  });

  test("empty formal set rejects with 400", async () => {
    const { deps, state } = depsWith();
    state.discoveryResult = { versions: [], officialVersion: null, warning: null };
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.1.0" }),
    });
    expect(res.status).toBe(400);
    expect(state.writeCalls.length).toBe(0);
  });

  test("preserves 409 when upgrade already running and does not change env", async () => {
    const { deps, state } = depsWith();
    state.upgradeState = "running";
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.1.0" }),
    });
    expect(res.status).toBe(409);
    expect(state.writeCalls.length).toBe(0);
    expect(state.runCalls).toBe(0);
  });

  test("serializes concurrent upgrade starts before changing env", async () => {
    let releaseUpgrade: (() => void) | undefined;
    const upgradeStarted = new Promise<void>((resolve) => {
      releaseUpgrade = resolve;
    });
    const { deps, state } = depsWith({
      runUpgrade: async () => {
        state.runCalls++;
        await upgradeStarted;
        return true;
      },
    });
    const app = createUpgradeRoutes(deps);
    const request = () => app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.1.0" }),
    });

    const first = await request();
    const second = await request();
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(state.writeCalls.length).toBe(1);
    expect(state.runCalls).toBe(1);
    releaseUpgrade?.();
  });

  test("dev build restriction rejects POST", async () => {
    const { deps, state } = depsWith({ readVersion: () => "dev" });
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "v1.1.0" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>)["error"]).toContain("Dev build");
    expect(state.writeCalls.length).toBe(0);
  });

  test("invalid JSON body rejected", async () => {
    const { deps } = depsWith();
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  test("missing version field rejected", async () => {
    const { deps } = depsWith();
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("preserves SSE/status/log behavior (factory exposes log)", async () => {
    const { deps } = depsWith();
    const app = createUpgradeRoutes(deps);
    const res = await app.request("http://localhost/api/upgrade/status");
    expect(res.status).toBe(200);
  });
});
