import { describe, expect, test } from "bun:test";
import { evaluate } from "./evaluate";
import { parseManifest } from "./parse-manifest";
import { parseRecords } from "./parse-records";
import { createCapture, createManifestInput, createRecordsInput, fixtureTokenMetricVerifier, sha256 } from "./test-support";

function createEvaluation() {
  const manifest = parseManifest(createManifestInput());
  const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);
  return { manifest, records };
}

function withRecord(
  records: ReturnType<typeof createEvaluation>["records"],
  index: number,
  update: (record: ReturnType<typeof createEvaluation>["records"][number]) => ReturnType<typeof createEvaluation>["records"][number],
) {
  return records.map((record, recordIndex) => (recordIndex === index ? update(record) : record));
}

describe("evaluate", () => {
  test("returns disable-routing below the 20 percent threshold", () => {
    const { manifest, records } = createEvaluation();
    const adjusted = records.map((record) => ({
      ...record,
      tokenMetrics: record.profile === "lossless" ? { source: "runtime" as const, scope: "call" as const, tokensOut: 100 } : { source: "runtime" as const, scope: "call" as const, tokensOut: 80.01 },
    }));

    const result = evaluate(manifest, adjusted);

    expect(result.verdict.verdict).toBe("disable-routing");
    expect(result.verdict.netBenefitPercent).toBeCloseTo(19.99, 2);
  });

  test("returns retain at exactly 20 percent with complete trusted metrics", () => {
    const { manifest, records } = createEvaluation();
    const result = evaluate(manifest, records);

    expect(result.verdict.verdict).toBe("retain");
    expect(result.verdict.netBenefitPercent).toBe(25);
  });

  test("disables routing for one incident", () => {
    const { manifest, records } = createEvaluation();
    const adjusted = withRecord(records, 0, (record) => ({
      ...record,
      leanctx: createCapture({ markerDetected: true }),
    }));

    const result = evaluate(manifest, adjusted);

    expect(result.verdict.verdict).toBe("disable-routing");
    expect(result.incidents.some((incident) => incident.kind === "marker")).toBe(true);
  });

  test("disables routing with a reason when a trusted metric is missing", () => {
    const { manifest, records } = createEvaluation();
    const adjusted = withRecord(records, 0, (record) => ({ ...record, tokenMetrics: null }));

    const result = evaluate(manifest, adjusted);

    expect(result.verdict.verdict).toBe("disable-routing");
    expect(result.verdict.metricsComplete).toBe(false);
    expect(result.verdict.reasons.some((reason) => reason.includes("token"))).toBe(true);
  });

  test("disables routing when lossless token denominator is zero", () => {
    const { manifest, records } = createEvaluation();
    const adjusted = records.map((record) => ({
      ...record,
      tokenMetrics: { source: "runtime" as const, scope: "session" as const, tokensOut: 0 },
    }));

    const result = evaluate(manifest, adjusted);

    expect(result.verdict.verdict).toBe("disable-routing");
    expect(result.verdict.netBenefitPercent).toBeNull();
  });

  test.each([
    ["timeout", { timedOut: true }],
    ["marker", { markerDetected: true }],
    ["appended content", { appendedContentDetected: true }],
  ])("classifies %s as an integrity incident", (kind, override) => {
    const { manifest, records } = createEvaluation();
    const adjusted = withRecord(records, 0, (record) => ({ ...record, leanctx: createCapture(override) }));

    const result = evaluate(manifest, adjusted);

    expect(result.incidents.some((incident) => incident.kind === kind.replace(" ", "-") || incident.kind === kind)).toBe(true);
  });

  test("classifies a capture hash or byte mismatch", () => {
    const { manifest, records } = createEvaluation();
    const adjusted = withRecord(records, 0, (record) => ({
      ...record,
      leanctx: createCapture({ stdoutBytes: 99 }),
    }));

    const result = evaluate(manifest, adjusted);

    expect(result.incidents.some((incident) => incident.kind === "output-mismatch")).toBe(true);
  });

  test("classifies an independent hash mismatch", () => {
    const { manifest, records } = createEvaluation();
    const adjusted = withRecord(records, 0, (record) => ({
      ...record,
      leanctx: createCapture({ stdoutSha256: "f".repeat(64) }),
    }));

    const result = evaluate(manifest, adjusted);

    expect(result.incidents.some((incident) => incident.kind === "output-mismatch")).toBe(true);
  });

  test("honors the expected both-nonzero exit contract", () => {
    const input = createManifestInput();
    const scenarios = input["scenarios"];
    if (!Array.isArray(scenarios)) throw new Error("test fixture is malformed");
    const first = scenarios[0];
    if (typeof first !== "object" || first === null || Array.isArray(first)) throw new Error("test fixture is malformed");
    input["scenarios"] = [{ ...first, expectation: "both-nonzero", expectedExit: 2 }, ...scenarios.slice(1)];
    expect(() => parseManifest(input)).toThrow();
  });

  test("accepts a declared reject-allowed exit contract", () => {
    const input = createManifestInput();
    const scenarios = input["scenarios"];
    if (!Array.isArray(scenarios)) throw new Error("test fixture is malformed");
    const first = scenarios[0];
    if (typeof first !== "object" || first === null || Array.isArray(first)) throw new Error("test fixture is malformed");
    input["scenarios"] = [{ ...first, expectation: "reject-allowed", allowedComparisonExitCodes: [1] }, ...scenarios.slice(1)];
    expect(() => parseManifest(input)).toThrow();
  });

  test("accepts a perfect pass", () => {
    const { manifest, records } = createEvaluation();

    const result = evaluate(manifest, records);

    expect(result.incidents).toHaveLength(0);
    expect(result.verdict.verdict).toBe("retain");
  });

  test("is not affected by record ordering", () => {
    const { manifest, records } = createEvaluation();

    const result = evaluate(manifest, [...records].reverse());

    expect(result.verdict.verdict).toBe("retain");
    expect(result.verdict.recordCount).toBe(40);
  });
});
