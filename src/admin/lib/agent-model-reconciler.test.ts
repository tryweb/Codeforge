import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentModelReconciler } from "./agent-model-reconciler";
import type { AgentModelsDeps } from "./agent-model-types";
import type { ExecResult } from "./docker";

type Fixture = {
  readonly deps: AgentModelsDeps;
  readonly calls: string[];
  readonly applied: Array<readonly [string, readonly { readonly model: string }[]]>;
  readonly cleanup: () => void;
};

function fixture(config: string, provider: string, agents: string, probes: Record<string, string> = {}): Fixture {
  const calls: string[] = [];
  const applied: Array<readonly [string, readonly { readonly model: string }[]]> = [];
  const dir = mkdtempSync(join(tmpdir(), "agent-model-reconciler-"));
  const deps: AgentModelsDeps = {
    exec: async (command: string): Promise<ExecResult> => {
      calls.push(command);
      if (command.includes(".agents // {}")) return { stdout: config, stderr: "", exitCode: 0 };
      if (command.includes("/provider")) return { stdout: provider, stderr: "", exitCode: 0 };
      if (command.includes("/agent")) return { stdout: agents, stderr: "", exitCode: 0 };
      for (const [model, response] of Object.entries(probes)) {
        if (command.includes(model)) return { stdout: response, stderr: "", exitCode: 0 };
      }
      if (command.includes("title:\"model availability probe\"")) {
        return { stdout: healthy("p", "alpha"), stderr: "", exitCode: 0 };
      }
      if (command.includes("/session")) return { stdout: healthy("p", "alpha"), stderr: "", exitCode: 0 };
      return { stdout: "{}", stderr: "", exitCode: 0 };
    },
    restart: async () => ({ ok: true }),
    readEnv: () => ({ OPENCODE_SERVER_PASSWORD: "testpass" }),
    snapshotDir: dir,
  };
  return { deps, calls, applied, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const liveAgents = JSON.stringify([
  { name: "general", mode: "subagent", model: { providerID: "missing", modelID: "default" } },
  { name: "plan", mode: "subagent", model: { providerID: "missing", modelID: "default" } },
]);

function healthy(providerID: string, modelID: string): string {
  return JSON.stringify({ info: { role: "assistant", providerID, modelID } });
}

describe("agent model reconciler", () => {
  test("keeps a healthy primary and does not write", async () => {
    const ctx = fixture(
      JSON.stringify({ general: { model: "p/keep" } }),
      JSON.stringify({ connected: ["p"], all: [{ id: "p", models: { keep: { capabilities: {} } } }] }),
      liveAgents,
      { keep: healthy("p", "keep") },
    );
    const reconciler = createAgentModelReconciler(ctx.deps);
    const summary = await reconciler.reconcileAll();
    expect(summary.changed).toBe(0);
    expect(ctx.calls.some((call) => call.includes(".agents[$agent]"))).toBe(false);
    ctx.cleanup();
  });

  test("ranks capabilities deterministically and probes only until the first healthy candidate", async () => {
    const ctx = fixture(
      JSON.stringify({ general: {} }),
      JSON.stringify({ connected: ["p"], all: [{ id: "p", models: {
        zed: { capabilities: { toolcall: true } },
        alpha: { capabilities: { toolcall: true, attachment: true } },
      } }] }),
      liveAgents,
      { "alpha": healthy("p", "alpha") },
    );
    const reconciler = createAgentModelReconciler(ctx.deps);
    const result = await reconciler.reconcileAll();
    expect(result.changed).toBe(2);
    expect(ctx.calls.some((call) => call.includes("p/alpha"))).toBe(true);
    expect(ctx.calls.some((call) => call.includes("p/zed"))).toBe(false);
    ctx.cleanup();
  });

  test("serializes concurrent runs and reruns once when a writer is pending", async () => {
    let release: (() => void) | undefined;
    let entered = 0;
    const ctx = fixture(JSON.stringify({ general: {} }), JSON.stringify({ connected: [], all: [] }), liveAgents);
    const original = ctx.deps.exec;
    const deps: AgentModelsDeps = { ...ctx.deps, exec: async (command, timeout) => {
      if (command.includes(".agents // {}")) {
        entered += 1;
        if (entered === 1) await new Promise<void>((resolve) => { release = resolve; });
      }
      return original(command, timeout);
    } };
    const reconciler = createAgentModelReconciler(deps);
    const first = reconciler.reconcileAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = reconciler.reconcileAll();
    release?.();
    await Promise.all([first, second]);
    expect(entered).toBe(2);
    ctx.cleanup();
  });

  test("keeps inconclusive primary probes fail-open", async () => {
    const ctx = fixture(
      JSON.stringify({ general: { model: "p/keep" } }),
      JSON.stringify({ connected: ["p"], all: [{ id: "p", models: { keep: { capabilities: {} }, other: { capabilities: {} } } }] }),
      liveAgents,
      { keep: JSON.stringify({ info: { role: "assistant", error: "temporary" } }) },
    );
    const result = await createAgentModelReconciler(ctx.deps).reconcileAll();
    expect(result.changed).toBe(0);
    ctx.cleanup();
  });

  test("counts probe_failed from applyAndVerify as a reconciliation failure", async () => {
    const ctx = fixture(
      JSON.stringify({ general: { model: "p/bad" } }),
      JSON.stringify({ connected: ["p"], all: [{ id: "p", models: { alpha: { capabilities: {} } } }] }),
      JSON.stringify([{ name: "general", mode: "subagent", model: { providerID: "p", modelID: "alpha" } }]),
    );
    let probeCount = 0;
    const originalExec = ctx.deps.exec;
    const deps: AgentModelsDeps = {
      ...ctx.deps,
      exec: async (command, timeout) => {
        if (command.includes("title:\"model availability probe\"")) {
          probeCount += 1;
          if (probeCount === 1 || probeCount === 3) return { stdout: JSON.stringify({ info: { role: "assistant", error: "404 unavailable" } }), stderr: "", exitCode: 0 };
        }
        return originalExec(command, timeout);
      },
    };
    const result = await createAgentModelReconciler(deps).reconcileAll();
    expect(result.changed).toBe(1);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    ctx.cleanup();
  });
});
