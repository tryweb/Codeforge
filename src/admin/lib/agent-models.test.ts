import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAgentModelsLib,
  validateFallbackModels,
  buildJqWriteCommand,
  displayNameToKey,
  OMO_CONFIG,
  type AgentModelsDeps,
} from "./agent-models";
import type { ExecResult as DockerExecResult } from "./docker";

type ExecResponse = { stdout: string; stderr?: string; exitCode?: number };

function stubDeps(responses: ExecResponse[] = []) {
  const calls: string[] = [];
  let restartCount = 0;
  const dir = mkdtempSync(join(tmpdir(), "agent-models-test-"));
  const deps: AgentModelsDeps = {
    exec: async (command: string, _timeoutMs?: number): Promise<DockerExecResult> => {
      calls.push(command);
      const next = responses.shift() ?? { stdout: "", exitCode: 0 };
      return { stdout: next.stdout, stderr: next.stderr ?? "", exitCode: next.exitCode ?? 0 };
    },
    restart: async () => {
      restartCount += 1;
      return { ok: true };
    },
    readEnv: () => ({ OPENCODE_SERVER_PASSWORD: "testpass" }),
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

describe("validateFallbackModels", () => {
  test("accepts valid entries with and without variant", () => {
    expect(validateFallbackModels({ entries: [{ model: "opencode-go/kimi-k3" }] })).toBeNull();
    expect(validateFallbackModels({ entries: [{ model: "gpt-5.6-sol", variant: "max" }] })).toBeNull();
  });

  test("rejects non-object bodies", () => {
    expect(validateFallbackModels(null)).toContain("JSON object");
    expect(validateFallbackModels("x")).toContain("JSON object");
    expect(validateFallbackModels([])).toContain("JSON object");
  });

  test("rejects non-array entries", () => {
    expect(validateFallbackModels({ entries: "nope" })).toContain("entries must be an array");
  });

  test("rejects missing or non-string model", () => {
    expect(validateFallbackModels({ entries: [{}] })).toContain("non-empty string model");
    expect(validateFallbackModels({ entries: [{ model: 42 }] })).toContain("non-empty string model");
    expect(validateFallbackModels({ entries: [{ model: "" }] })).toContain("non-empty string model");
  });

  test("rejects invalid variant", () => {
    expect(validateFallbackModels({ entries: [{ model: "x", variant: "turbo" }] })).toContain(
      "variant must be one of",
    );
  });
});

describe("buildJqWriteCommand", () => {
  test("delete case drops all model keys without a payload", () => {
    const cmd = buildJqWriteCommand("sisyphus", []);
    expect(cmd).toContain(
      `del(.agents[$agent].model, .agents[$agent].variant, .agents[$agent].models, .agents[$agent].fallback_models)`,
    );
    expect(cmd).toContain(`mv /tmp/omo.jsonc.tmp ${OMO_CONFIG}`);
    expect(cmd).not.toContain("base64");
  });

  test("single-entry case writes the model string plus variant", () => {
    const cmd = buildJqWriteCommand("sisyphus-junior", [{ model: "gpt-5.6-sol", variant: "medium" }]);
    expect(cmd).toContain(`--arg agent 'sisyphus-junior'`);
    expect(cmd).toContain(`--arg model 'gpt-5.6-sol'`);
    expect(cmd).toContain(`.agents[$agent].model = $model`);
    expect(cmd).toContain(`.agents[$agent].variant = "medium"`);
    expect(cmd).toContain(`del(.agents[$agent].models, .agents[$agent].fallback_models)`);
  });

  test("chain case writes only the primary model, dropping the rest", () => {
    const cmd = buildJqWriteCommand("explore", [
      { model: "gpt-5.6-sol", variant: "high" },
      { model: "kimi-k3" },
    ]);
    expect(cmd).toContain(`--arg model 'gpt-5.6-sol'`);
    expect(cmd).toContain(`.agents[$agent].model = $model`);
    expect(cmd).toContain(`.agents[$agent].variant = "high"`);
    expect(cmd).toContain(`del(.agents[$agent].models, .agents[$agent].fallback_models)`);
    expect(cmd).not.toContain("kimi-k3");
    expect(cmd).not.toContain("base64");
  });
});

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
    expect(readFileSync(snapshot!, "utf-8")).toBe(content);

    const restore = await lib.restoreAgentModelsConfig(snapshot!);
    expect(restore.ok).toBe(true);
    const restoreCmd = calls[1]!;
    const b64 = restoreCmd.match(/echo '([^']+)'/)?.[1];
    expect(b64).toBeDefined();
    expect(Buffer.from(b64!, "base64").toString("utf-8")).toBe(content);
    cleanup();
  });
});

describe("getServerPassword", () => {
  test("returns the env value when present", () => {
    const { deps } = stubDeps();
    expect(createAgentModelsLib(deps).getServerPassword()).toBe("testpass");
  });

  test("returns null when absent", async () => {
    const { deps } = stubDeps();
    deps.readEnv = () => ({});
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
    const script = calls[0]!;
    const expectedAuth = Buffer.from("opencode:testpass").toString("base64");
    expect(script).toContain(`Authorization: Basic ${expectedAuth}`);
    expect(script).toContain("/agent");
  });

  test("returns null on curl failure", async () => {
    const { deps } = stubDeps([{ stdout: "", exitCode: 2 }]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchResolvedAgentModels("testpass")).toBeNull();
  });
});

describe("displayNameToKey", () => {
  const keys = new Set(["sisyphus", "plan", "explore", "sisyphus-junior", "oracle"]);

  test("maps 'Key - Role' display names to config keys", () => {
    expect(displayNameToKey("Sisyphus - ultraworker", keys)).toBe("sisyphus");
    expect(displayNameToKey("Sisyphus-Junior", keys)).toBe("sisyphus-junior");
  });

  test("passes plain display names through unchanged", () => {
    expect(displayNameToKey("plan", keys)).toBe("plan");
    expect(displayNameToKey("oracle", keys)).toBe("oracle");
  });

  test("returns null for unknown built-ins", () => {
    expect(displayNameToKey("build", keys)).toBeNull();
    expect(displayNameToKey("compaction", keys)).toBeNull();
  });
});

describe("fetchConnectedCatalog", () => {
  test("returns unique model ids across connected providers", async () => {
    const { deps } = stubDeps([
      { stdout: '{"connected":["openai","opencode-go"]}' }, // r1 connected-providers
      { stdout: "openai\nopencode-go\n" }, // r2 provider keys (unused when conn non-empty)
      { stdout: "gpt-5.6-sol\ngpt-5.6-luna-fast\nkimi-k3\n" }, // r3 model ids
    ]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchConnectedCatalog("testpass")).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-luna-fast",
      "kimi-k3",
    ]);
  });

  test("falls back to all catalog providers when connected-providers cache is absent", async () => {
    const { deps } = stubDeps([
      { stdout: "", exitCode: 1 }, // r1 connected-providers missing
      { stdout: "openai\nopencode-go\n" }, // r2 provider keys
      { stdout: "kimi-k3\ngpt-5.6-sol\n" }, // r3 model ids
    ]);
    const lib = createAgentModelsLib(deps);
    expect(await lib.fetchConnectedCatalog("testpass")).toEqual(["kimi-k3", "gpt-5.6-sol"]);
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
      "gpt-5.6-luna-fast",
      "gpt-5.6-terra",
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
    const result = await lib.applyAndVerify("explore", [{ model: "claude-opus-5" }]);
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
    const { deps, calls, restartCount, cleanup } = stubDeps([
      { stdout: '{"agents":{}}' }, // snapshot
      { stdout: "" }, // write
    ]);
    deps.restart = async () => ({ ok: false, error: "compose failed" });
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
});
