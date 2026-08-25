import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseManifest } from "./parse-manifest";
import { parseRecords } from "./parse-records";
import { evaluate } from "./evaluate";
import { createManifestInput, createRecordsInput, fixtureTokenMetricVerifier } from "./test-support";
import { isRecord } from "./boundary";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("fixture schema alignment", () => {
  test("declares the required manifest and record property sets", () => {
    const schema = readJson("test/fixtures/leanctx-evaluation.schema.json");
    if (!isRecord(schema)) throw new Error("schema fixture is malformed");
    const defs = schema["$defs"];
    if (!isRecord(defs)) throw new Error("schema fixture is malformed");
    const record = defs["record"];
    const capture = defs["capture"];
    if (!isRecord(record)) throw new Error("record schema is malformed");
    if (!isRecord(capture)) throw new Error("capture schema is malformed");

    expect(record["required"]).toEqual([
      "scenarioId",
      "profile",
      "direct",
      "leanctx",
      "outputEqual",
      "exitContractSatisfied",
      "tokenMetrics",
      "incidents",
    ]);
    expect(capture["required"]).toEqual([
      "stdoutBytes",
      "stderrBytes",
      "stdoutSha256",
      "stderrSha256",
      "exitCode",
      "durationMs",
      "timedOut",
      "markerDetected",
      "appendedContentDetected",
    ]);
  });

  test("golden verdict cases agree with the evaluator threshold contract", () => {
    const golden = readJson("test/fixtures/leanctx-evaluation.golden.json");
    if (!isRecord(golden)) throw new Error("golden fixture is malformed");
    const cases = golden["verdictCases"];
    if (!Array.isArray(cases)) throw new Error("golden fixture has no verdict cases");

    for (const item of cases) {
      if (!isRecord(item)) throw new Error("golden case is malformed");
      const input = item["input"];
      const expected = item["expected"];
      if (!isRecord(input)) throw new Error("golden input is malformed");
      if (!isRecord(expected)) throw new Error("golden expected is malformed");
      const incidents = input["incidents"];
      const metricsComplete = input["metricsComplete"];
      const benefit = input["netBenefitPercent"];
      const recordCount = input["recordCount"];
      const scenarioCount = input["scenarioCount"];
      const shouldRetain = incidents === 0 && metricsComplete === true && recordCount === 40 && scenarioCount === 20 && typeof benefit === "number" && benefit >= 20;
      expect(expected["verdict"]).toBe(shouldRetain ? "retain" : "disable-routing");
    }
  });

  test("the corrected fixtures parse as a complete run", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);
    const result = evaluate(manifest, records);

    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.normalizedRecordsHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
