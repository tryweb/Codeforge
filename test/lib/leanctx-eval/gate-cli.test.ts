import { describe, expect, test } from "bun:test";
import { runCli, type CliIo } from "./cli";

describe("check-gates CLI", () => {
  test("reads captured JSON and emits deterministic gate results", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      readFile: async () =>
        JSON.stringify({
          inputs: [
            {
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
            },
          ],
        }),
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    };

    const exitCode = await runCli(["check-gates", "captured.json"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toEqual({
      g0: { passed: true, status: "healthy", details: [] },
      g1: { passed: false, status: "indeterminate", details: [], statuses: ["healthy"] },
    });
  });
});
