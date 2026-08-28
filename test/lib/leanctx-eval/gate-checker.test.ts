import { describe, expect, test } from "bun:test";
import {
  EXPECTED_SENTINEL_BYTES,
  EXPECTED_SENTINEL_SHA256,
  evaluateCapturedDrift,
  runReliabilityGates,
  type CapturedDriftInput,
  type DriftStatus,
} from "./gate-checker";

const exactSentinel = {
  stdout: "lean-ctx-reliability-sentinel-v1\n",
  stderr: "",
  exitCode: 0,
  timedOut: false,
  expectedBytes: EXPECTED_SENTINEL_BYTES,
  expectedSha256: EXPECTED_SENTINEL_SHA256,
};

function input(overrides: Partial<CapturedDriftInput> = {}): CapturedDriftInput {
  return {
    baseline: { present: true, compressionLevel: "lite" },
    global: { present: true, compressionLevel: "lite" },
    project: { present: false, compressionLevel: null },
    sentinel: exactSentinel,
    ...overrides,
  };
}

describe("captured drift gate checker", () => {
  test("maps the six statuses using production precedence", () => {
    const cases: ReadonlyArray<readonly [string, CapturedDriftInput, DriftStatus]> = [
      ["healthy", input(), "healthy"],
      ["config drift", input({ baseline: { present: true, compressionLevel: "off" } }), "config_drift"],
      ["project override", input({ project: { present: true, compressionLevel: "max" } }), "project_override"],
      ["daemon unavailable", input({ sentinel: { ...exactSentinel, timedOut: true } }), "daemon_unavailable"],
      ["behavior mismatch", input({ sentinel: { ...exactSentinel, stdout: "[lean-ctx: marker]\n" } }), "behavioral_mismatch"],
      ["indeterminate", input({ baseline: { present: true, compressionLevel: null } }), "indeterminate"],
    ];

    for (const [name, captured, status] of cases) {
      expect(evaluateCapturedDrift(captured).status, name).toBe(status);
    }
  });

  test("prioritizes malformed and read errors over every later observation", () => {
    const result = evaluateCapturedDrift(
      input({
        baseline: { present: true, compressionLevel: "lite", malformed: true },
        global: { present: true, compressionLevel: "lite", readError: "unavailable" },
        project: { present: true, compressionLevel: "max" },
        sentinel: { ...exactSentinel, timedOut: true },
      }),
    );

    expect(result.status).toBe("indeterminate");
  });

  test("G0 passes only for healthy exact lite baseline and sentinel", () => {
    expect(runReliabilityGates([input()]).g0.passed).toBe(true);
    expect(runReliabilityGates([input({ sentinel: { ...exactSentinel, exitCode: 1 } })]).g0.passed).toBe(false);
    expect(runReliabilityGates([input({ baseline: { present: true, compressionLevel: "off" } })]).g0.passed).toBe(false);
  });

  test("G1 passes when its matrix contains every non-healthy status and healthy", () => {
    const matrix = [
      input(),
      input({ baseline: { present: true, compressionLevel: "off" } }),
      input({ project: { present: true, compressionLevel: "max" } }),
      input({ sentinel: { ...exactSentinel, exitCode: 1 } }),
      input({ sentinel: { ...exactSentinel, stdout: "wrong\n" } }),
      input({ baseline: { present: true, compressionLevel: null } }),
    ];

    const result = runReliabilityGates(matrix);
    expect(result.g1.passed).toBe(true);
    expect(result.g1.statuses).toEqual(["healthy", "config_drift", "project_override", "daemon_unavailable", "behavioral_mismatch", "indeterminate"]);
  });

  test("G1 fails when six inputs all resolve to healthy", () => {
    const result = runReliabilityGates(Array.from({ length: 6 }, () => input()));

    expect(result.g1.passed).toBe(false);
  });

  test("gate contracts encode no mutation-capable command", async () => {
    const source = await Promise.all([
      Bun.file("test/lib/leanctx-eval/gate-checker.ts").text(),
      Bun.file("test/lib/leanctx-eval/cli.ts").text(),
    ]).then((files) => files.join("\n"));
    expect(source).not.toMatch(/config\s+(apply|set)|restart|writeRaw|rm\s|sed\s+-i|tee\s/);
  });
});
