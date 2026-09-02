import { beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { listHandlers, stubDeps } from "./agent-models-test-support";

const { createAgentModelsRoutes } = await import("./agent-models");

beforeEach(() => {
  rmSync(join(process.env.HOME ?? "", ".cache/openchamber/agent-model-reconcile.lock"), { recursive: true, force: true });
});

describe("createAgentModelsRoutes — PUT /api/agent-models/:agent", () => {
  test("clears an existing configured model", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"librarian":{"model":"opencode/nemotron-3.5-lightning-free"}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode-go"]}' },
      { match: /provider-models\.json/, stdout: "opencode-go/qwen3.7-plus\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([
        { name: "librarian", mode: "subagent", model: { modelID: "qwen3.7-plus", providerID: "opencode-go" } },
      ]) },
      { match: /cat ~\/\.omo\/omo\.jsonc/, stdout: '{"agents":{}}' },
      { match: /del\(\.agents\[\$agent\]\.model/, stdout: "" },
    ]);
    const response = await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models/librarian", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "cleared" });
    cleanup();
  });

  test("rejects invalid entries with 400 and does not write", async () => {
    const { deps, calls, cleanup } = stubDeps([]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: 42 }] }),
    });
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
    cleanup();
  });

  test("rejects multiple model entries with 400 before any write or restart", async () => {
    const { deps, calls, cleanup } = stubDeps([]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "opencode/big-pickle" }, { model: "openai/gpt-5.6-sol" }] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("at most one");
    expect(calls.some((call) => call.includes("jq "))).toBe(false);
    expect(calls.length).toBe(0);
    cleanup();
  });

  test("rejects an invalid agent name", async () => {
    const { deps, cleanup } = stubDeps([]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/BAD NAME", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "x" }] }),
    });
    expect(res.status).toBe(400);
    cleanup();
  });

  test("rejects with 409 when password is absent (degraded mode)", async () => {
    const { deps, calls, cleanup } = stubDeps([], null);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "openai/gpt-5.6-sol" }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("OPENCODE_SERVER_PASSWORD");
    expect(calls.length).toBe(0);
    cleanup();
  });

  test("rejects agents that are not live subagents", async () => {
    const { deps, calls, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"plan":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([
        { name: "plan", mode: "primary", model: { modelID: "big-pickle", providerID: "opencode" } },
      ]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "opencode/big-pickle" }] }),
    });
    expect(res.status).toBe(403);
    expect(calls.some((call) => call.includes(".agents[$agent].model = $model"))).toBe(false);
    cleanup();
  });

  test("rejects models outside the current environment catalog", async () => {
    const { deps, calls, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"plan":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([
        { name: "plan", mode: "subagent", model: { modelID: "big-pickle", providerID: "opencode" } },
      ]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "openai/gpt-5.6-sol" }] }),
    });
    expect(res.status).toBe(400);
    expect(calls.some((call) => call.includes(".agents[$agent].model = $model"))).toBe(false);
    cleanup();
  });

  test("returns verified when the resolved model matches", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"plan":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /cat ~\/\.omo\/omo\.jsonc/, stdout: '{"agents":{}}' },
      { match: /\.agents\[\$agent\]\.model = \$model/, stdout: "" },
      { match: /\/agent\b/, stdout: JSON.stringify([
        { name: "plan", mode: "subagent", model: { modelID: "big-pickle", providerID: "opencode" } },
      ]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "opencode/big-pickle", variant: "medium" }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "verified",
      resolved: { modelID: "big-pickle", providerID: "opencode" },
    });
    cleanup();
  });

  test("returns write_failed when the jq write fails", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"explore":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([
        { name: "explore", mode: "subagent", model: { modelID: "big-pickle", providerID: "opencode" } },
      ]) },
      { match: /cat ~\/\.omo\/omo\.jsonc/, stdout: "/tmp/omo.jsonc.snapshot-test" },
      { match: /\.agents\[\$agent\]\.model = \$model/, stdout: "", exitCode: 1, stderr: "jq: parse error" },
      { match: /cat '\/tmp\/omo\.jsonc\.snapshot-test'/, stdout: "" },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/explore", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "opencode/big-pickle" }] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.status).toBe("write_failed");
    expect(data.error).toContain("jq");
    cleanup();
  });
});

describe("createAgentModelsRoutes — GET /agent-models page", () => {
  test("renders the page with agent rows", async () => {
    const { deps, cleanup } = stubDeps(listHandlers());
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/agent-models");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent Models");
    expect(html).toContain("plan");
    expect(html).toContain("kimi-k3");
    expect(html).toContain("Use automatic model");
    expect(html).toContain("Suggestion providers");
    expect(html).toContain("All providers");
    expect(html).toContain("Generate suggestions");
    expect(html).toContain("Generating model suggestions");
    expect(html).toContain("Checking provider models and preparing pending changes");
    cleanup();
  });

  test("renders the prerequisite warning when password is absent", async () => {
    const { deps, cleanup } = stubDeps(listHandlers(), null);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/agent-models");
    const html = await res.text();
    expect(html).toContain("Prerequisite missing");
    cleanup();
  });
});

describe("createAgentModelsRoutes — POST /api/agent-models/suggestions", () => {
  test("returns suggestions restricted to the selected provider", async () => {
    const { deps, calls, cleanup } = stubDeps(listHandlers());
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["opencode-go"] }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.providers).toEqual(["openai", "opencode-go"]);
    for (const entries of Object.values(data.suggestions) as Array<Array<{ model: string }>>) {
      expect(entries[0]?.model.startsWith("opencode-go/")).toBe(true);
    }
    expect(calls.some((call) => call.includes(".agents[$agent]"))).toBe(false);
    cleanup();
  });

  test("defaults to all connected providers", async () => {
    const { deps, cleanup } = stubDeps(listHandlers());
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    for (const entries of Object.values(data.suggestions) as Array<Array<{ model: string }>>) {
      expect(["openai/gpt-5.6-sol", "opencode-go/kimi-k3"]).toContain(entries[0]?.model);
    }
    cleanup();
  });

  test("rejects an unknown provider without writing config", async () => {
    const { deps, calls, cleanup } = stubDeps(listHandlers());
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["missing"] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not connected");
    expect(calls.some((call) => call.includes(".agents[$agent]"))).toBe(false);
    cleanup();
  });

  test("rejects malformed provider selection", async () => {
    const { deps, cleanup } = stubDeps([]);
    const res = await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: [42] }),
    });
    expect(res.status).toBe(400);
    cleanup();
  });
});

describe("createAgentModelsRoutes — verification mode", () => {
  test("rejects invalid verification with 400 for single-agent Apply", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"plan":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([{ name: "plan", mode: "subagent", model: { modelID: "big-pickle", providerID: "opencode" } }]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "opencode/big-pickle" }], verification: "bad" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("verification");
    cleanup();
  });

  test("rejects invalid verification with 400 for batch Apply", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"plan":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([{ name: "plan", mode: "subagent", model: { modelID: "big-pickle", providerID: "opencode" } }]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [{ agent: "plan", entries: [{ model: "opencode/big-pickle" }] }], verification: "invalid" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("verification");
    cleanup();
  });

  test("readiness batch Apply issues zero model-message calls", async () => {
    const { deps, calls, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"plan":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode"]}' },
      { match: /provider-models\.json/, stdout: "opencode/big-pickle\n" },
      { match: /cat ~\/\.omo\/omo\.jsonc/, stdout: '{"agents":{}}' },
      { match: /\.agents\[\$agent\]\.model = \$model/, stdout: "" },
      { match: /\/agent\b/, stdout: JSON.stringify([{ name: "plan", mode: "subagent", model: { modelID: "big-pickle", providerID: "opencode" } }]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [{ agent: "plan", entries: [{ model: "opencode/big-pickle" }] }] }),
    });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.includes("POST") && c.includes("/session/") && c.includes("message"))).toBe(false);
    expect(calls.some((c) => c.includes("title:\"model availability probe\""))).toBe(false);
    expect(calls.some((c) => c.includes("POST") && c.includes("/session/") && c.includes("/message"))).toBe(false);
    cleanup();
  });

  test("empty batch Apply is a no-op without execution", async () => {
    const { deps, calls, cleanup } = stubDeps([], null);
    const res = await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: {} });
    expect(calls).toEqual([]);
    cleanup();
  });
});
