import { describe, expect, test } from "bun:test";
import { createAgentModelsRoutes } from "./agent-models";
import { listHandlers, stubDeps } from "./agent-models-test-support";

describe("createAgentModelsRoutes — GET /api/agent-models", () => {
  test("returns configured live subagents and excludes primary agents", async () => {
    const { deps, cleanup } = stubDeps(listHandlers());
    const res = await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models");
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.hasPassword).toBe(true);

    const plan = data.agents.find((agent: { name: string }) => agent.name === "plan");
    expect(plan.configured).toEqual([{ model: "opencode-go/kimi-k3", variant: "max" }]);
    expect(plan.resolved).toEqual({ modelID: "kimi-k3", providerID: "opencode-go" });
    expect(plan.source).toBe("configured");
    expect(plan.invalid).toBe(false);
    expect(plan.effectiveness).toBe("effective");
    expect(data.agents.find((agent: { name: string }) => agent.name === "oracle")).toBeUndefined();
    expect(data.catalog).toEqual(["openai/gpt-5.6-sol", "opencode-go/kimi-k3"]);
    cleanup();
  });

  test("flags agents whose config has unrecognized keys as invalid", async () => {
    const { deps, cleanup } = stubDeps([
      {
        match: /jq -c '\.agents/,
        stdout:
          '{"explore":{"permission":{"bash":"allow"},"model":"opencode-go/kimi-k3"},"plan":{"model":"opencode-go/kimi-k3"}}',
      },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode-go"]}' },
      { match: /provider-models\.json/, stdout: "opencode-go/kimi-k3\n" },
      {
        match: /\/agent\b/,
        stdout: JSON.stringify([
          { name: "explore", mode: "subagent", model: { modelID: "kimi-k3", providerID: "opencode-go" } },
          { name: "plan", mode: "subagent", model: { modelID: "kimi-k3", providerID: "opencode-go" } },
        ]),
      },
    ]);
    const res = await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models");
    const data = await res.json();
    const explore = data.agents.find((agent: { name: string }) => agent.name === "explore");
    expect(explore.invalid).toBe(true);
    expect(explore.configured).toEqual([{ model: "opencode-go/kimi-k3" }]);
    expect(explore.effectiveness).toBe("invalid");
    expect(data.agents.find((agent: { name: string }) => agent.name === "plan").invalid).toBe(false);
    cleanup();
  });

  test("reports runtime mismatch when configured and live primary models differ", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"librarian":{"model":"opencode/nemotron-3.5-lightning-free"}}' },
      {
        match: /\/provider\b/,
        stdout: JSON.stringify({
          connected: ["opencode", "opencode-go"],
          all: [
            { id: "opencode", models: { "nemotron-3.5-lightning-free": {} } },
            { id: "opencode-go", models: { "qwen3.7-plus": {} } },
          ],
        }),
      },
      {
        match: /provider-models\.json/,
        stdout: "opencode/nemotron-3.5-lightning-free\nopencode-go/qwen3.7-plus\n",
      },
      {
        match: /\/agent\b/,
        stdout: JSON.stringify([
          { name: "librarian", mode: "subagent", model: { modelID: "qwen3.7-plus", providerID: "opencode-go" } },
        ]),
      },
      {
        match: /\/session/,
        stdout: JSON.stringify({ info: { role: "assistant", modelID: "qwen3.7-plus", providerID: "opencode-go" } }),
      },
    ]);
    const res = await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models");
    const data = await res.json();
    const librarian = data.agents.find((agent: { name: string }) => agent.name === "librarian");
    expect(librarian.effectiveness).toBe("runtime_mismatch");
    cleanup();
  });

  test("maps display names back to config keys", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"sisyphus":{},"atlas":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["opencode-go"]}' },
      { match: /provider-models\.json/, stdout: "opencode-go/kimi-k3\n" },
      {
        match: /\/agent\b/,
        stdout: JSON.stringify([
          { name: "Sisyphus - ultraworker", mode: "subagent", model: { modelID: "kimi-k3", providerID: "opencode-go" } },
          { name: "Atlas - Plan Executor", mode: "subagent", model: { modelID: "claude-sonnet-5", providerID: "anthropic" } },
          { name: "build", mode: "primary", model: null },
        ]),
      },
    ]);
    const data = await (await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models")).json();
    expect(data.agents.find((agent: { name: string }) => agent.name === "sisyphus").resolved).toEqual({
      modelID: "kimi-k3",
      providerID: "opencode-go",
    });
    expect(data.agents.find((agent: { name: string }) => agent.name === "atlas").resolved).toEqual({
      modelID: "claude-sonnet-5",
      providerID: "anthropic",
    });
    expect(data.agents.some((agent: { name: string }) => agent.name === "build")).toBe(false);
    cleanup();
  });

  test("includes configurable native subagents but excludes internal agents", async () => {
    const { deps, cleanup } = stubDeps([
      { match: /jq -c '\.agents/, stdout: '{"explore":{}}' },
      { match: /connected-providers\.json/, stdout: '{"connected":["openai"]}' },
      { match: /provider-models\.json/, stdout: "openai/gpt-5.6-luna-fast\n" },
      {
        match: /\/agent\b/,
        stdout: JSON.stringify([
          { name: "general", mode: "subagent", model: null },
          { name: "build", mode: "subagent", model: null },
          { name: "compaction", mode: "subagent", model: null },
          { name: "summary", mode: "subagent", model: null },
          { name: "title", mode: "subagent", model: null },
          { name: "explore", mode: "subagent", model: { modelID: "gpt-5.6-luna-fast", providerID: "openai" } },
        ]),
      },
    ]);
    const data = await (await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models")).json();
    const names = data.agents.map((agent: { name: string }) => agent.name);
    expect(names).toContain("general");
    expect(names).toContain("explore");
    const general = data.agents.find((agent: { name: string }) => agent.name === "general");
    expect(general.configured).toEqual([]);
    expect(general.resolved).toBeNull();
    expect(general.requestVerified).toEqual({ modelID: "big-pickle", providerID: "opencode" });
    expect(general.effectiveness).toBe("plugin");
    expect(names).not.toContain("build");
    expect(names).not.toContain("compaction");
    expect(names).not.toContain("summary");
    expect(names).not.toContain("title");
    cleanup();
  });

  test("degraded mode omits resolved models when password is absent", async () => {
    const { deps, calls, cleanup } = stubDeps(listHandlers(), null);
    const data = await (await createAgentModelsRoutes(deps).request("http://localhost/api/agent-models")).json();
    expect(data.hasPassword).toBe(false);
    for (const agent of data.agents) expect(agent.resolved).toBeNull();
    expect(calls.some((command) => command.includes("/agent"))).toBe(false);
    cleanup();
  });
});
