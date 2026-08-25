import { describe, expect, test } from "bun:test";
import {
  BASELINE_CONFIG_PATH,
  EXPECTED_SENTINEL_OUTPUT,
  GLOBAL_CONFIG_PATH,
  LEAN_CTX_SENTINEL_COMMAND,
  PROJECT_CONFIG_PATH,
  detectLeanCtxDrift,
  type ConfigReadResult,
  type LeanCtxDriftDeps,
} from "./leanctx-drift";
import type { ExecResult } from "./docker";

type FixtureOptions = {
  readonly baseline?: string | null;
  readonly global?: string | null;
  readonly project?: string | null;
  readonly sentinel?: ExecResult | "hang";
  readonly readError?: string;
  readonly readHang?: boolean;
};

function createFixture(options: FixtureOptions = {}): {
  readonly deps: LeanCtxDriftDeps;
  readonly calls: readonly string[];
} {
  const calls: string[] = [];
  const contents: Readonly<Record<string, string | null>> = {
    [BASELINE_CONFIG_PATH]: options.baseline ?? 'compression_level = "off"\n',
    [GLOBAL_CONFIG_PATH]: options.global ?? 'compression_level = "off"\n',
    [PROJECT_CONFIG_PATH]: options.project ?? null,
  };

  const readConfig = async (path: string): Promise<ConfigReadResult> => {
    if (options.readHang) return await new Promise<ConfigReadResult>(() => undefined);
    if (options.readError) return { content: null, error: options.readError };
    return { content: contents[path] ?? null };
  };

  const exec = async (command: string, _timeoutMs: number): Promise<ExecResult> => {
    calls.push(command);
    if (command.includes("config apply") || command.includes("restart")) {
      throw new Error("mutation command is forbidden in drift detection");
    }
    if (options.sentinel === "hang") return await new Promise<ExecResult>(() => undefined);
    return options.sentinel ?? { stdout: EXPECTED_SENTINEL_OUTPUT, stderr: "", exitCode: 0 };
  };

  return { deps: { readConfig, exec }, calls };
}

describe("detectLeanCtxDrift", () => {
  test("reports healthy for explicit-off layers and an exact sentinel", async () => {
    const fixture = createFixture();

    const result = await detectLeanCtxDrift(fixture.deps, { now: () => "2026-08-25T00:00:00.000Z" });

    expect(result.status).toBe("healthy");
    expect(result.done).toBe(true);
    expect(result.checkedAt).toBe("2026-08-25T00:00:00.000Z");
    expect(fixture.calls).toEqual([LEAN_CTX_SENTINEL_COMMAND]);
  });

  test("reports config_drift for a lossy baseline or global layer", async () => {
    const baselineFixture = createFixture({ baseline: 'compression_level = "lite"\n' });
    const globalFixture = createFixture({ global: 'compression_level = "standard"\n' });

    const baselineResult = await detectLeanCtxDrift(baselineFixture.deps);
    const globalResult = await detectLeanCtxDrift(globalFixture.deps);

    expect(baselineResult.status).toBe("config_drift");
    expect(globalResult.status).toBe("config_drift");
    expect(baselineFixture.calls).toEqual([]);
    expect(globalFixture.calls).toEqual([]);
  });

  test("reports project_override for a lossy project layer", async () => {
    const fixture = createFixture({ project: 'compression_level = "max"\n' });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("project_override");
    expect(fixture.calls).toEqual([]);
  });

  test("reports indeterminate for malformed TOML", async () => {
    const fixture = createFixture({ global: "compression_level = [\n" });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("indeterminate");
    expect(result.details.join(" ")).toContain("global");
    expect(fixture.calls).toEqual([]);
  });

  test("reports indeterminate when a config read fails", async () => {
    const fixture = createFixture({ readError: "config read unavailable" });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("indeterminate");
    expect(result.details.join(" ")).toContain("config read unavailable");
    expect(fixture.calls).toEqual([]);
  });

  test("reports indeterminate when a config read exceeds the bounded timeout", async () => {
    const fixture = createFixture({ readHang: true });
    const started = performance.now();

    const result = await detectLeanCtxDrift(fixture.deps, { timeoutMs: 5 });

    expect(result.status).toBe("indeterminate");
    expect(performance.now() - started).toBeLessThan(250);
    expect(result.details.join(" ")).toContain("config read timed out");
    expect(fixture.calls).toEqual([]);
  });

  test("reports daemon_unavailable for a non-zero sentinel command", async () => {
    const fixture = createFixture({ sentinel: { stdout: "", stderr: "daemon unavailable", exitCode: 1 } });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("daemon_unavailable");
    expect(result.details.join(" ")).toContain("code 1");
  });

  test("reports daemon_unavailable when the sentinel exceeds the bounded timeout", async () => {
    const fixture = createFixture({ sentinel: "hang" });
    const started = performance.now();

    const result = await detectLeanCtxDrift(fixture.deps, { timeoutMs: 5 });

    expect(result.status).toBe("daemon_unavailable");
    expect(performance.now() - started).toBeLessThan(250);
    expect(result.details.join(" ")).toContain("timed out");
  });

  test("reports behavioral_mismatch for a triage marker", async () => {
    const fixture = createFixture({ sentinel: { stdout: "[lean-ctx: 1 lines filtered by triage]\n", stderr: "", exitCode: 0 } });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("behavioral_mismatch");
    expect(result.details.join(" ")).toContain("marker");
  });

  test("reports behavioral_mismatch for unrelated appended content", async () => {
    const fixture = createFixture({ sentinel: { stdout: `${EXPECTED_SENTINEL_OUTPUT}unrelated\n`, stderr: "", exitCode: 0 } });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("behavioral_mismatch");
    expect(result.details.join(" ")).toContain("byte");
  });

  test("reports behavioral_mismatch for a byte and hash mismatch", async () => {
    const fixture = createFixture({ sentinel: { stdout: EXPECTED_SENTINEL_OUTPUT.slice(0, -1), stderr: "", exitCode: 0 } });

    const result = await detectLeanCtxDrift(fixture.deps);

    expect(result.status).toBe("behavioral_mismatch");
    expect(result.details.join(" ")).toContain("hash");
  });
});
