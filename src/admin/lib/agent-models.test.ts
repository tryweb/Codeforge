import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentModelsLib, type AgentModelsDeps } from "./agent-models";
import type { ExecResult as DockerExecResult } from "./docker";

type ExecResponse = { stdout: string; stderr?: string; exitCode?: number };
type StubOptions = { readonly password?: string | null; readonly restart?: AgentModelsDeps["restart"] };

function stubDeps(responses: ExecResponse[] = [], options: StubOptions = {}) {
  const calls: string[] = [];
  let restartCount = 0;
  const dir = mkdtempSync(join(tmpdir(), "agent-models-test-"));
  const deps: AgentModelsDeps = {
    exec: async (command: string, _timeoutMs?: number): Promise<DockerExecResult> => {
      calls.push(command);
      const next = responses.shift() ?? { stdout: "", exitCode: 0 };
      return { stdout: next.stdout, stderr: next.stderr ?? "", exitCode: next.exitCode ?? 0 };
    },
    restart: options.restart ?? (async () => { restartCount += 1; return { ok: true }; }),
    readEnv: (): Record<string, string> => options.password === null ? {} : { OPENCODE_SERVER_PASSWORD: options.password ?? "testpass" },
    snapshotDir: dir,
  };
  return {
    deps,
    calls,
    get restartCount() {
      return restartCount;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("readAgentModelsConfig", () => {
  test("parses model primary plus fallback_models chain from stdout", async () => {
    const { deps } = stubDeps([
      {
        stdout:
          '{"plan":{"model":"opencode-go/kimi-k3","variant":"max","fallback_models":[{"model":"opencode-go/qwen3.7-plus"}]}}',
      },
    ]);
    const lib = createAgentModelsLib(deps);
    const config = await lib.readAgentModelsConfig();
    expect(config.plan?.models).toEqual([
      { model: "opencode-go/kimi-k3", variant: "max" },
      { model: "opencode-go/qwen3.7-plus" },
    ]);
    expect(config.plan?.invalid).toBe(false);
  });

  test("flags entries with unrecognized keys (e.g. legacy permission) as invalid", async () => {
    const { deps } = stubDeps([
      { stdout: '{"explore":{"permission":{"bash":"allow"},"model":"opencode-go/kimi-k3"}}' },
    ]);
    const lib = createAgentModelsLib(deps);
    const config = await lib.readAgentModelsConfig();
    expect(config.explore?.invalid).toBe(true);
    expect(config.explore?.models?.[0]).toEqual({ model: "opencode-go/kimi-k3" });
  });

  test("returns empty map when jq fails", async () => {
    const { deps } = stubDeps([{ stdout: "", exitCode: 1 }]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.readAgentModelsConfig()).toEqual({});
  });
});

describe("snapshot / restore round-trip", () => {
  test("snapshot saves content to snapshotDir and restore pushes it back via base64", async () => {
    const content = '{"$schema":"x","agents":{"plan":{"fallback_models":[{"model":"kimi-k3"}]}}}';
    const { deps, calls, cleanup } = stubDeps([{ stdout: content }]);
    const lib = createAgentModelsLib(deps);
    const snapshot = await lib.snapshotAgentModelsConfig();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;
    expect(readFileSync(snapshot, "utf-8")).toBe(content);

    const restore = await lib.restoreAgentModelsConfig(snapshot);
    expect(restore.ok).toBe(true);
    const restoreCmd = calls[1];
    expect(restoreCmd).toBeDefined();
    if (restoreCmd === undefined) return;
    const b64 = restoreCmd.match(/echo '([^']+)'/)?.[1];
    expect(b64).toBeDefined();
    if (b64 === undefined) return;
    expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(content);
    cleanup();
  });
});

describe("getServerPassword", () => {
  test("returns the env value when present", () => {
    const { deps } = stubDeps();
    expect(createAgentModelsLib(deps).getServerPassword()).toBe("testpass");
  });

  test("returns null when absent", async () => {
    const { deps } = stubDeps([], { password: null });
    expect(createAgentModelsLib(deps).getServerPassword()).toBeNull();
  });
});

describe("fetchResolvedAgentModels", () => {
  test("builds Basic auth header and parses name → model", async () => {
    const agentsJson = JSON.stringify([
      { name: "Sisyphus - ultraworker", model: { modelID: "kimi-k3", providerID: "opencode-go" } },
      { name: "explore", model: { modelID: "gpt-5.6-luna-fast", providerID: "openai" } },
      { name: "build", model: null },
    ]);
    const { deps, calls } = stubDeps([{ stdout: agentsJson }]);
    const lib = createAgentModelsLib(deps);
    const map = await lib.fetchResolvedAgentModels("testpass");
    expect(map?.get("Sisyphus - ultraworker")).toEqual({ modelID: "kimi-k3", providerID: "opencode-go" });
    expect(map?.get("explore")?.modelID).toBe("gpt-5.6-luna-fast");
    expect(map?.has("build")).toBe(false);
    const script = calls[0];
    expect(script).toBeDefined();
    if (script === undefined) return;
    const expectedAuth = Buffer.from("opencode:testpass").toString("base64");
    expect(script).toContain(`Authorization: Basic ${expectedAuth}`);
    expect(script).toContain("/agent");
    expect(script).toContain("for attempt in");
    expect(script.indexOf("for attempt in")).toBeLessThan(script.indexOf("for f in ~/.config/openchamber/managed-opencode"));
    expect(script).not.toContain(`[ -n "$PORT" ] || exit 3`);
  });

  test("returns null on curl failure", async () => {
    const { deps } = stubDeps([{ stdout: "", exitCode: 2 }]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchResolvedAgentModels("testpass")).toBeNull();
  });
});

describe("fetchConnectedCatalog", () => {
  test("returns unique provider/model ids across connected providers", async () => {
    const { deps, calls } = stubDeps([
      { stdout: '{"connected":["openai","opencode-go"]}' }, // r1 connected-providers
      { stdout: "openai\nopencode-go\n" }, // r2 provider keys (unused when conn non-empty)
      { stdout: "openai/gpt-5.6-sol\nopenai/gpt-5.6-luna-fast\nopencode-go/kimi-k3\n" },
    ]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchConnectedCatalog("testpass")).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-luna-fast",
      "opencode-go/kimi-k3",
    ]);
    expect(calls[2]).toContain('"\\($provider)/\\(.id)"');
  });

  test("falls back to all catalog providers when connected-providers cache is absent", async () => {
    const { deps } = stubDeps([
      { stdout: "", exitCode: 1 }, // r1 connected-providers missing
      { stdout: "openai\nopencode-go\n" }, // r2 provider keys
      { stdout: "opencode-go/kimi-k3\nopenai/gpt-5.6-sol\n" }, // r3 model ids
    ]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchConnectedCatalog("testpass")).toEqual([
      "opencode-go/kimi-k3",
      "openai/gpt-5.6-sol",
    ]);
  });

  test("falls back to live /agent models when all caches are absent", async () => {
    const agentsJson = JSON.stringify([
      { name: "explore", model: { modelID: "gpt-5.6-luna-fast", providerID: "openai" } },
      { name: "momus", model: { modelID: "gpt-5.6-terra", providerID: "openai" } },
    ]);
    const { deps } = stubDeps([
      { stdout: "", exitCode: 1 }, // r1 connected-providers missing
      { stdout: "", exitCode: 1 }, // r2 provider keys missing
      { stdout: agentsJson }, // r4 /agent fallback
    ]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchConnectedCatalog("testpass")).toEqual([
      "openai/gpt-5.6-luna-fast",
      "openai/gpt-5.6-terra",
    ]);
  });
});

describe("applyAndVerify", () => {
  test("success: verified when write, restart and /agent reachability succeed", async () => {
    const agentsJson = JSON.stringify([
      { name: "explore", model: { modelID: "gpt-5.6-luna-fast", providerID: "openai" } },
    ]);
    const { deps, cleanup } = stubDeps([
      { stdout: '{"agents":{}}' }, // snapshot: cat
      { stdout: "" }, // write: jq ok
      { stdout: agentsJson }, // fetch
    ]);
    const lib = createAgentModelsLib(deps);
    const result = await lib.applyAndVerify("explore", [{ model: "openai/gpt-5.6-luna-fast" }]);
    expect(result).toMatchObject({
      ok: true,
      status: "verified",
      resolved: { modelID: "gpt-5.6-luna-fast", providerID: "openai" },
    });
    cleanup();
  });

  test("write failure reports write_failed without restarting", async () => {
    const { deps, restartCount, cleanup } = stubDeps([
      { stdout: '{"agents":{}}' }, // snapshot
      { stdout: "", exitCode: 1, stderr: "jq: parse error" }, // write fails
    ]);
    const lib = createAgentModelsLib(deps);
    const result = await lib.applyAndVerify("explore", [{ model: "claude-opus-5" }]);
    expect(result).toMatchObject({ ok: false, status: "write_failed", error: "jq: parse error" });
    expect(restartCount).toBe(0);
    cleanup();
  });

  test("restart failure rolls back the snapshot without a second restart", async () => {
    const { deps, calls, restartCount, cleanup } = stubDeps(
      [
        { stdout: '{"agents":{}}' }, // snapshot
        { stdout: "" }, // write
      ],
      { restart: async () => ({ ok: false, error: "compose failed" }) },
    );
    const lib = createAgentModelsLib(deps);
    const result = await lib.applyAndVerify("explore", [{ model: "claude-opus-5" }]);
    expect(result).toMatchObject({ ok: false, status: "restart_failed", error: "compose failed" });
    expect(restartCount).toBe(0);
    // snapshot restored back into the container
    expect(calls.some((c) => c.includes("base64 -d > ~/.omo/omo.jsonc"))).toBe(true);
    cleanup();
  });

  test("fetch failure does not roll back: reports unverified", async () => {
    const ctx = stubDeps([
      { stdout: '{"agents":{}}' }, // snapshot
      { stdout: "" }, // write
      { stdout: "", exitCode: 2 }, // fetch fails
    ]);
    const lib = createAgentModelsLib(ctx.deps);
    const result = await lib.applyAndVerify("explore", [{ model: "claude-opus-5" }]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: "unverified" });
    expect(ctx.restartCount).toBe(1); // no rollback restart
    expect(ctx.calls.some((c) => c.includes("base64 -d > ~/.omo/omo.jsonc"))).toBe(false);
    ctx.cleanup();
  });

  test("reports runtime_mismatch without restoring the applied model", async () => {
    const agentsJson = JSON.stringify([
      { name: "librarian", model: { modelID: "qwen3.7-plus", providerID: "opencode-go" } },
    ]);
    const ctx = stubDeps([
      { stdout: '{"agents":{"librarian":{}}}' },
      { stdout: "" },
      { stdout: agentsJson },
    ]);
    const lib = createAgentModelsLib(ctx.deps);
    const result = await lib.applyAndVerify("librarian", [
      { model: "opencode/nemotron-3.5-lightning-free" },
    ]);
    expect(result).toMatchObject({
      ok: false,
      status: "runtime_mismatch",
      configured: "opencode/nemotron-3.5-lightning-free",
      resolved: { modelID: "qwen3.7-plus", providerID: "opencode-go" },
      error: "Configured model opencode/nemotron-3.5-lightning-free was persisted, but the live agent resolved opencode-go/qwen3.7-plus",
    });
    expect(ctx.calls.some((command) => command.includes("base64 -d > ~/.omo/omo.jsonc"))).toBe(false);
    ctx.cleanup();
  });
});
