import { describe, expect, test } from "bun:test";
import { runCli, type CliIo } from "./cli";
import { createManifestInput, createRecordsInput } from "./test-support";

function fakeIo(files: Readonly<Record<string, string>>): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      readFile: async (path) => files[path] ?? "",
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
    stdout,
    stderr,
  };
}

describe("evaluation CLI", () => {
  test("valid disable-routing runs exit 0", async () => {
    const manifest = JSON.stringify(createManifestInput());
    const records = createRecordsInput((scenarioId) => (scenarioId === "src-read-small" ? { markerDetected: true } : {})).map((record) => ({ ...record, tokenMetrics: null }));
    const fixture = fakeIo({ manifest, records: JSON.stringify(records) });

    const exitCode = await runCli(["evaluate", "--manifest", "manifest", "--records", "records"], fixture.io);

    expect(exitCode).toBe(0);
    expect(fixture.stdout.join(" ")).toContain("disable-routing");
  });

  test("malformed manifest exits nonzero", async () => {
    const fixture = fakeIo({ manifest: "{", records: "[]" });

    const exitCode = await runCli(["validate-manifest", "manifest"], fixture.io);

    expect(exitCode).toBe(1);
    expect(fixture.stderr.join(" ")).toContain("invalid JSON");
  });

  test("render emits deterministic Markdown", async () => {
    const fixture = fakeIo({ manifest: JSON.stringify(createManifestInput()), records: JSON.stringify(createRecordsInput().map((record) => ({ ...record, tokenMetrics: null }))) });

    const exitCode = await runCli(["render", "--manifest", "manifest", "--records", "records"], fixture.io);

    expect(exitCode).toBe(0);
    expect(fixture.stdout.join(" ")).toContain("# Lean Context Evaluation");
  });
});
