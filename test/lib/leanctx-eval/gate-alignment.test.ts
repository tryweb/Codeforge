import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { evaluateCapturedDrift, DRIFT_STATUSES, isCapturedDriftInput, runReliabilityGates, type CapturedDriftInput, type DriftStatus } from "./gate-checker";
import { isRecord } from "./boundary";

type DriftFixture = {
  readonly expectedStatuses: readonly DriftStatus[];
  readonly inputs: readonly (CapturedDriftInput & { readonly name: string })[];
};

describe("drift alignment fixture", () => {
  test("covers each production status exactly once", () => {
    const parsed: unknown = JSON.parse(readFileSync("test/fixtures/leanctx-drift-vectors.json", "utf8"));
    if (!isDriftFixture(parsed)) throw new Error("drift fixture is malformed");
    const fixture = parsed;
    const statuses = fixture.inputs.map((input) => evaluateCapturedDrift(input).status);

    expect([...fixture.expectedStatuses]).toEqual([...DRIFT_STATUSES]);
    expect(statuses).toEqual([...DRIFT_STATUSES]);
    expect(runReliabilityGates(fixture.inputs).g1.passed).toBe(true);
  });

  test("supports captured raw TOML observations without importing Admin runtime code", () => {
    const fixture: CapturedDriftInput = {
      baseline: { present: true, raw: 'compression_level = "off"\n' },
      global: { present: true, raw: 'compression_level = "off"\n' },
      project: { present: false, raw: "" },
      sentinel: {
        stdout: "lean-ctx-reliability-sentinel-v1\n",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        expectedBytes: 33,
        expectedSha256: "266b4f79b67bef0b8d79d1683b016f4b4c42dc40aca415c7086316f754203b64",
      },
    };

    expect(evaluateCapturedDrift(fixture).status).toBe("healthy");
  });
});

function isDriftFixture(value: unknown): value is DriftFixture {
  if (!isRecord(value)) return false;
  const statuses = value["expectedStatuses"];
  const inputs = value["inputs"];
  return Array.isArray(statuses) && statuses.every(isDriftStatus) && Array.isArray(inputs) && inputs.every((input) => isRecord(input) && typeof input["name"] === "string" && isCapturedDriftInput({ baseline: input["baseline"], global: input["global"], project: input["project"], sentinel: input["sentinel"] }));
}

function isDriftStatus(value: unknown): value is DriftStatus {
  return DRIFT_STATUSES.some((status) => status === value);
}
