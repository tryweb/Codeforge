import { describe, expect, test } from "bun:test";
import { createAgentSettingsRoutes, validateAgentConfig, applyAgentConfig, type AgentSettingsDeps } from "./agent";

function memoryDeps(initial: Record<string, string> = {}): {
  deps: AgentSettingsDeps;
  store: Record<string, string>;
  reloads: number;
} {
  const store: Record<string, string> = { ...initial };
  let reloads = 0;
  return {
    store,
    deps: {
      readEnv: () => ({ ...store }),
      upsert: (key, value) => { store[key] = value; },
      remove: (key) => { delete store[key]; },
      reload: () => { reloads++; return { state: "disabled", last_error: null }; },
      status: () => ({ state: "disabled", last_error: null }),
    },
    get reloads() { return reloads; },
  };
}

describe("validateAgentConfig", () => {
  test("accepts a minimal empty object", () => {
    expect(validateAgentConfig({})).toBeNull();
  });

  test("accepts a valid wss URL", () => {
    expect(validateAgentConfig({ CENTER_URL: "wss://center.example.com/ws?token=abc" })).toBeNull();
  });

  test("accepts a valid ws URL", () => {
    expect(validateAgentConfig({ CENTER_URL: "ws://localhost:9000" })).toBeNull();
  });

  test("rejects an https URL", () => {
    const error = validateAgentConfig({ CENTER_URL: "https://center.example.com/ws" });
    expect(error).toContain("ws:// or wss://");
  });

  test("rejects a malformed URL", () => {
    const error = validateAgentConfig({ CENTER_URL: "not a url" });
    expect(error).toContain("valid URL");
  });

  test("rejects a non-object body", () => {
    expect(validateAgentConfig("nope")).toContain("JSON object");
    expect(validateAgentConfig(null)).toContain("JSON object");
  });

  test("rejects non-string values", () => {
    const error = validateAgentConfig({ AGENT_ID: 42 });
    expect(error).toContain("AGENT_ID must be a string");
  });
});

describe("applyAgentConfig", () => {
  test("upserts non-empty values and deletes empty ones", () => {
    const { deps, store } = memoryDeps({ AGENT_ID: "old-id" });
    applyAgentConfig(deps, { CENTER_URL: "ws://c:9000", AGENT_ID: "", CENTER_TOKEN: undefined });
    expect(store.CENTER_URL).toBe("ws://c:9000");
    expect(store.AGENT_ID).toBeUndefined();
  });

  test("trims values before storing", () => {
    const { deps, store } = memoryDeps();
    applyAgentConfig(deps, { AGENT_ID: "  my-agent  " });
    expect(store.AGENT_ID).toBe("my-agent");
  });

  test("reloads after applying", () => {
    const ctx = memoryDeps();
    applyAgentConfig(ctx.deps, { CENTER_URL: "ws://c:9000" });
    expect(ctx.reloads).toBe(1);
  });
});

describe("createAgentSettingsRoutes", () => {
  test("GET /api/agent/status returns current state", async () => {
    const { deps } = memoryDeps();
    const app = createAgentSettingsRoutes(deps);
    const res = await app.request("http://localhost/api/agent/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "disabled", last_error: null });
  });

  test("PUT /api/agent/config applies and returns agent status", async () => {
    const { deps, store } = memoryDeps();
    const app = createAgentSettingsRoutes(deps);
    const res = await app.request("http://localhost/api/agent/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CENTER_URL: "wss://center.example.com/ws" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, agent_status: { state: "disabled", last_error: null } });
    expect(store.CENTER_URL).toBe("wss://center.example.com/ws");
  });

  test("PUT /api/agent/config rejects an invalid URL with 400", async () => {
    const { deps, store } = memoryDeps();
    const app = createAgentSettingsRoutes(deps);
    const res = await app.request("http://localhost/api/agent/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CENTER_URL: "https://center.example.com/ws" }),
    });
    expect(res.status).toBe(400);
    expect(store.CENTER_URL).toBeUndefined();
  });

  test("GET /agent renders the settings page with env values", async () => {
    const { deps } = memoryDeps({ CENTER_URL: "wss://c.example.com/ws", AGENT_ID: "my-agent" });
    const app = createAgentSettingsRoutes(deps);
    const res = await app.request("http://localhost/agent");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Connection");
    expect(html).toContain("wss://c.example.com/ws");
    expect(html).toContain("my-agent");
    expect(html).toContain("CENTER_TOKEN");
  });
});