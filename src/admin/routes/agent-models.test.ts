import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentModelsRoutes } from "./agent-models";
import type { AgentModelsDeps } from "../lib/agent-models";
import type { ExecResult } from "../lib/docker";

interface ExecHandler {
  match: RegExp;
  stdout?: string;
  exitCode?: number;
}

/** exec stub that responds by matching the command text (order-independent). */
function stubDeps(handlers: ExecHandler[]) {
  const calls: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "agent-models-routes-"));
  const deps: AgentModelsDeps = {
    exec: async (command: string, _timeoutMs?: number): Promise<ExecResult> => {
      calls.push(command);
      for (const h of handlers) {
        if (h.match.test(command)) {
          return { stdout: h.stdout ?? "", stderr: "", exitCode: h.exitCode ?? 0 };
        }
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    },
    restart: async () => ({ ok: true }),
    readEnv: () => ({ OPENCODE_SERVER_PASSWORD: "testpass" }),
    snapshotDir: dir,
  };
  return {
    deps,
    calls,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const CONFIG_JSON =
  '{"plan":{"models":[{"model":"kimi-k3","variant":"max"}]},"prometheus":{"models":[{"model":"kimi-k3"}]}}';
const AGENTS_JSON = JSON.stringify([
  { name: "plan", model: { modelID: "kimi-k3", providerID: "opencode-go" } },
  { name: "oracle", model: { modelID: "gpt-5.6-sol", providerID: "openai" } },
]);

function listHandlers(): ExecHandler[] {
  return [
    { match: /jq -c '\.agents/, stdout: CONFIG_JSON },
    { match: /connected-providers\.json/, stdout: '{"connected":["openai","opencode-go"]}' },
    { match: /provider-models\.json/, stdout: "gpt-5.6-sol\nkimi-k3\n" },
    { match: /\/agent\b/, stdout: AGENTS_JSON },
  ];
}

describe("createAgentModelsRoutes — GET /api/agent-models", () => {
  test("merges configured agents with live resolved models", async () => {
    const { deps, cleanup } = stubDeps(listHandlers());
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasPassword).toBe(true);

    const plan = data.agents.find((a: { name: string }) => a.name === "plan");
    expect(plan.configured[0].model).toBe("kimi-k3");
    expect(plan.resolved).toEqual({ modelID: "kimi-k3", providerID: "opencode-go" });
    expect(plan.source).toBe("configured");
    expect(plan.invalid).toBe(false);

    // oracle exists only on the resolved side -> plugin source
    const oracle = data.agents.find((a: { name: string }) => a.name === "oracle");
    expect(oracle.source).toBe("plugin");
    expect(oracle.resolved).toEqual({ modelID: "gpt-5.6-sol", providerID: "openai" });

    expect(data.catalog).toEqual(["gpt-5.6-sol", "kimi-k3"]);
    cleanup();
  });

  test("flags agents whose config has unrecognized keys as invalid", async () => {
    const { deps, cleanup } = stubDeps([
      {
        match: /jq -c '\.agents/,
        stdout:
          '{"explore":{"permission":{"bash":"allow"},"models":[{"model":"kimi-k3"}]},"plan":{"models":[{"model":"kimi-k3"}]}}',
      },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode-go"]}' },
      { match: /provider-models\.json/, stdout: "kimi-k3\n" },
      { match: /\/agent\b/, stdout: JSON.stringify([{ name: "plan", model: { modelID: "kimi-k3", providerID: "opencode-go" } }]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models");
    expect(res.status).toBe(200);
    const data = await res.json();
    const explore = data.agents.find((a: { name: string }) => a.name === "explore");
    expect(explore.invalid).toBe(true);
    expect(explore.configured).toEqual([{ model: "kimi-k3" }]);
    const plan = data.agents.find((a: { name: string }) => a.name === "plan");
    expect(plan.invalid).toBe(false);
    cleanup();
  });

  test("maps /agent display names back to config keys for resolved lookup", async () => {
    const agentsJson = JSON.stringify([
      { name: "Sisyphus - ultraworker", model: { modelID: "kimi-k3", providerID: "opencode-go" } },
      { name: "Atlas - Plan Executor", model: { modelID: "claude-sonnet-5", providerID: "anthropic" } },
      { name: "build", model: null },
    ]);
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"sisyphus":{},"atlas":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode-go"]}' },
      { match: /provider-models\.json/, stdout: "kimi-k3\n" },
      { match: /\/agent\b/, stdout: agentsJson },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models");
    expect(res.status).toBe(200);
    const data = await res.json();

    const sisyphus = data.agents.find((a: { name: string }) => a.name === "sisyphus");
    expect(sisyphus.resolved).toEqual({ modelID: "kimi-k3", providerID: "opencode-go" });

    const atlas = data.agents.find((a: { name: string }) => a.name === "atlas");
    expect(atlas.resolved).toEqual({ modelID: "claude-sonnet-5", providerID: "anthropic" });

    // display names must not appear as separate rows; agents without a
    // resolved model and no config (opencode internals like "build") stay out
    expect(data.agents.some((a: { name: string }) => a.name === "Sisyphus - ultraworker")).toBe(false);
    expect(data.agents.some((a: { name: string }) => a.name === "build")).toBe(false);
    cleanup();
  });

  test("degraded mode omits resolved models when password is absent", async () => {
    const { deps, calls, cleanup } = stubDeps(listHandlers());
    deps.readEnv = () => ({});
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasPassword).toBe(false);
    for (const agent of data.agents) {
      expect(agent.resolved).toBeNull();
    }
    expect(calls.some((c) => c.includes("/agent"))).toBe(false);
    cleanup();
  });
});

describe("createAgentModelsRoutes — PUT /api/agent-models/:agent", () => {
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
    const { deps, calls, cleanup } = stubDeps([]);
    deps.readEnv = () => ({});
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "gpt-5.6-sol" }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("OPENCODE_SERVER_PASSWORD");
    expect(calls.length).toBe(0);
    cleanup();
  });

  test("returns verified when the resolved model matches", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /cat ~\/\.omo\/omo\.jsonc/, stdout: '{"agents":{}}' },
      { match: /base64 -d > \/tmp\/omo-fm/, stdout: "" },
      { match: /\/agent\b/, stdout: JSON.stringify([{ name: "plan", model: { modelID: "gpt-5.6-sol", providerID: "openai" } }]) },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "gpt-5.6-sol", variant: "medium" }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "verified",
      resolved: { modelID: "gpt-5.6-sol", providerID: "openai" },
    });
    cleanup();
  });

  test("returns write_failed when the jq write fails", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /cat ~\/\.omo\/omo\.jsonc/, stdout: '{"agents":{}}' },
      { match: /base64 -d > \/tmp\/omo-fm/, stdout: "", exitCode: 1, stderr: "jq: parse error" },
    ]);
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/api/agent-models/explore", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ model: "claude-opus-5" }] }),
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
    cleanup();
  });

  test("renders the prerequisite warning when password is absent", async () => {
    const { deps, cleanup } = stubDeps(listHandlers());
    deps.readEnv = () => ({});
    const app = createAgentModelsRoutes(deps);
    const res = await app.request("http://localhost/agent-models");
    const html = await res.text();
    expect(html).toContain("Prerequisite missing");
    cleanup();
  });
});
