import { describe, expect, test } from "bun:test";
import { runCli, type CliIo } from "./cli";
import { isRecord } from "./boundary";
import { parseCapturedDriftInput } from "./gate-checker";

function capturedInput(): Record<string, unknown> {
  return {
    baseline: { present: true, compressionLevel: "off" },
    global: { present: true, compressionLevel: "off" },
    project: { present: false, compressionLevel: null },
    sentinel: {
      stdout: "lean-ctx-reliability-sentinel-v1\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      expectedBytes: 33,
      expectedSha256: "266b4f79b67bef0b8d79d1683b016f4b4c42dc40aca415c7086316f754203b64",
    },
  };
}

async function check(value: unknown): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    readFile: async () => JSON.stringify({ inputs: [value] }),
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  };
  return { exitCode: await runCli(["check-gates", "captured.json"], io), stdout: stdout.join(""), stderr: stderr.join("") };
}

function mergeMember(base: Record<string, unknown>, member: string, patch: unknown): void {
  const current = base[member];
  if (!isRecord(current) || !isRecord(patch)) throw new Error("test fixture member is malformed");
  base[member] = { ...current, ...patch };
}

describe("check-gates JSON boundary", () => {
  test("rejects invalid required numbers and hashes", async () => {
    const cases = [
      { sentinel: { exitCode: -1 } },
      { sentinel: { exitCode: 1.5 } },
      { sentinel: { exitCode: "0" } },
      { sentinel: { expectedBytes: -1 } },
      { sentinel: { expectedBytes: 1.5 } },
      { sentinel: { expectedSha256: "not-a-sha256" } },
      { sentinel: { observedBytes: -1 } },
      { sentinel: { observedBytes: 1.5 } },
      { sentinel: { observedSha256: "not-a-sha256" } },
    ];

    for (const patch of cases) {
      const base = capturedInput();
      mergeMember(base, "sentinel", patch.sentinel);
      const result = await check(base);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
    }
  });

  test("rejects wrong optional types and unknown members", async () => {
    const cases = [
      { baseline: { raw: 1 } },
      { baseline: { readError: 1 } },
      { baseline: { malformed: "true" } },
      { sentinel: { stdout: 1 } },
      { sentinel: { stderr: 1 } },
      { sentinel: { execError: 1 } },
      { sentinel: { markerDetected: "true" } },
      { sentinel: { appendedContentDetected: "true" } },
      { unknown: true },
      { sentinel: { unknown: true } },
    ];

    for (const patch of cases) {
      const base = capturedInput();
      if ("sentinel" in patch) mergeMember(base, "sentinel", patch.sentinel);
      else if ("baseline" in patch) mergeMember(base, "baseline", patch.baseline);
      else Object.assign(base, patch);
      const result = await check(base);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
    }
  });

  test("rejects NaN-shaped numeric values and unknown envelope members", async () => {
    const invalid = capturedInput();
    mergeMember(invalid, "sentinel", { expectedBytes: Number.NaN });
    expect(() => parseCapturedDriftInput(invalid)).toThrow();

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      readFile: async () => JSON.stringify({ inputs: [capturedInput()], extra: true }),
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    };
    expect(await runCli(["check-gates", "captured.json"], io)).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join(" ")).toContain("unknown property extra");
  });
});
