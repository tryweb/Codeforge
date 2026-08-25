import { describe, expect, test } from "bun:test";
import { makeCapture, type CapturePair } from "./capture";
import { PROFILE_COMPRESSION, runProfile } from "./live";
import type { Scenario } from "./types";

const scenarios: readonly Scenario[] = [
  { id: "one", category: "test", command: "printf one", cwd: "/repo", readOnly: true, expectation: "exact-equal", expectedExit: 0, allowedComparisonExitCodes: [], repeatCount: 1 },
  { id: "two", category: "test", command: "printf two", cwd: "/repo", readOnly: true, expectation: "exact-equal", expectedExit: 0, allowedComparisonExitCodes: [], repeatCount: 2 },
];

function pair(value: string): CapturePair {
  return { direct: makeCapture(value, "", 0, 0, false), leanctx: makeCapture(value, "", 0, 0, false) };
}

describe("explicit live profiles", () => {
  test("runs one selected profile and emits one record per scenario", async () => {
    const records = await runProfile(scenarios, "comparison", async (scenario) => pair(scenario.id));
    expect(records).toHaveLength(scenarios.length);
    expect(records.every((record) => record.profile === "comparison")).toBe(true);
    expect(records.every((record) => record.direct.stdout === record.leanctx.stdout)).toBe(true);
  });

  test("requires distinct approved compression settings for the two profiles", () => {
    expect(PROFILE_COMPRESSION.lossless).toBe("off");
    expect(PROFILE_COMPRESSION.comparison).toBe("lite");
    expect(PROFILE_COMPRESSION.lossless).not.toBe(PROFILE_COMPRESSION.comparison);
  });

  test("records repeat mismatches across every nonvolatile capture field", async () => {
    let invocation = 0;
    const records = await runProfile(scenarios.slice(1), "comparison", async () => {
      invocation += 1;
      if (invocation === 1) return { direct: makeCapture("same", "", 0, 1, false), leanctx: makeCapture("same", "", 0, 1, false) };
      return { direct: makeCapture("same", "changed", 1, 2, true), leanctx: makeCapture("same", "changed", 1, 2, true) };
    });
    expect(records[0]?.incidents).toContain("output-mismatch");
  });
});
