import { describe, expect, test } from "bun:test";
import { parseManifest, parseManifestJson } from "./parse-manifest";
import { parseRecords, parseRecordsJson, type TokenMetricVerifier } from "./parse-records";
import { createManifestInput, createRecordsInput, fixtureTokenMetricVerifier, SCENARIO_IDS } from "./test-support";

describe("parseManifest", () => {
  test("accepts exactly the frozen 20 scenario manifest", () => {
    const manifest = parseManifest(createManifestInput());

    expect(manifest.scenarios).toHaveLength(20);
    expect(manifest.profiles).toEqual(["lossless", "comparison"]);
  });

  test("rejects a partial manifest with 19 scenarios", () => {
    const input = createManifestInput();
    const scenarios = input["scenarios"];
    if (!Array.isArray(scenarios)) throw new Error("test fixture is malformed");
    input["scenarios"] = scenarios.slice(0, 19);

    expect(() => parseManifest(input)).toThrow();
  });

  test("rejects a manifest with 21 scenarios", () => {
    const input = createManifestInput();
    const scenarios = input["scenarios"];
    if (!Array.isArray(scenarios)) throw new Error("test fixture is malformed");
    input["scenarios"] = [...scenarios, scenarios[0]];

    expect(() => parseManifest(input)).toThrow();
  });

  test.each([
    ["printf ok > output", "printf ok > output"],
    ["printf ok >> output", "printf ok >> output"],
    ["tee output", "printf ok | tee output"],
    ["rm output", "rm output"],
    ["mv output", "mv input output"],
    ["dd output", "dd if=input of=output"],
    ["command substitution", "printf $(date)"],
    ["backtick substitution", "printf `date`"],
  ])("rejects write-bearing command: %s", (_name, command) => {
    const input = createManifestInput();
    const scenarios = input["scenarios"];
    if (!Array.isArray(scenarios)) throw new Error("test fixture is malformed");
    const first = scenarios[0];
    if (typeof first !== "object" || first === null || Array.isArray(first)) {
      throw new Error("test fixture is malformed");
    }
    input["scenarios"] = [{ ...first, command }, ...scenarios.slice(1)];

    expect(() => parseManifest(input)).toThrow();
  });

  test("parses JSON only at the boundary and rejects malformed JSON", () => {
    expect(parseManifestJson(JSON.stringify(createManifestInput())).scenarios).toHaveLength(20);
    expect(() => parseManifestJson("{" )).toThrow();
  });

  test("rejects frozen command, category, and expectation substitutions", () => {
    for (const mutation of [
      { command: "sh -c 'touch /tmp/x'" },
      { command: "cp src/admin/package.json /tmp/x" },
      { category: "mutated-category" },
      { expectation: "reject-allowed" },
      { expectedExit: 7 },
      { repeatCount: 2 },
    ]) {
      const input = createManifestInput();
      const scenarios = input["scenarios"];
      if (!Array.isArray(scenarios)) throw new Error("test fixture is malformed");
      const first = scenarios[0];
      if (typeof first !== "object" || first === null || Array.isArray(first)) throw new Error("test fixture is malformed");
      input["scenarios"] = [{ ...first, ...mutation }, ...scenarios.slice(1)];
      expect(() => parseManifest(input)).toThrow();
    }
  });
});

describe("parseRecords", () => {
  test("accepts exactly 40 records, one per profile and scenario", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);

    expect(records).toHaveLength(40);
  });

  test("rejects duplicate records", () => {
    const manifest = parseManifest(createManifestInput());
    const records: unknown[] = [...createRecordsInput()];
    const first = records[0];
    if (first === undefined) throw new Error("test fixture is empty");
    records[1] = first;

    expect(() => parseRecords(records, manifest, undefined, fixtureTokenMetricVerifier)).toThrow(/duplicate/i);
  });

  test("rejects missing records", () => {
    const manifest = parseManifest(createManifestInput());

    expect(() => parseRecords(createRecordsInput().slice(0, 39), manifest, undefined, fixtureTokenMetricVerifier)).toThrow(/missing/i);
  });

  test("rejects an unknown scenario id", () => {
    const manifest = parseManifest(createManifestInput());
    const records: unknown[] = [...createRecordsInput()];
    const first = createRecordsInput()[0];
    if (first === undefined) throw new Error("test fixture is empty");
    records[0] = { ...first, scenarioId: "not-in-manifest" };

    expect(() => parseRecords(records, manifest, undefined, fixtureTokenMetricVerifier)).toThrow(/unknown/i);
  });

  test("rejects 40 unique records when one pair is substituted", () => {
    const manifest = parseManifest(createManifestInput());
    const records: unknown[] = [...createRecordsInput()];
    const first = records[0];
    if (first === undefined) throw new Error("test fixture is empty");
    records[0] = { ...first, scenarioId: "not-in-manifest" };

    expect(() => parseRecords(records, manifest, undefined, fixtureTokenMetricVerifier)).toThrow(/unknown|missing/i);
  });

  test("rejects an unknown record property", () => {
    const manifest = parseManifest(createManifestInput());
    const records: unknown[] = [...createRecordsInput()];
    const first = createRecordsInput()[0];
    if (first === undefined) throw new Error("test fixture is empty");
    records[0] = { ...first, unexpected: true };

    expect(() => parseRecords(records, manifest, undefined, fixtureTokenMetricVerifier)).toThrow();
  });

  test("allows a missing trusted metric so evaluation can disable routing", () => {
    const manifest = parseManifest(createManifestInput());
    const records = createRecordsInput();
    const first = records[0];
    if (first === undefined) throw new Error("test fixture is empty");
    records[0] = { ...first, tokenMetrics: null };

    expect(parseRecords(records, manifest, undefined, fixtureTokenMetricVerifier)[0]?.tokenMetrics).toBeNull();
  });

  test("rejects caller-supplied token numbers at the default JSON boundary", () => {
    const manifest = parseManifest(createManifestInput());
    const records = createRecordsInput().map((record) => ({ ...record, tokenMetrics: { source: "runtime", scope: "call", tokensOut: 1 } }));
    expect(() => parseRecordsJson(JSON.stringify(records), manifest)).toThrow(/verifier|trusted/i);
    const nullMetrics = createRecordsInput(undefined, () => 0).map((record) => ({ ...record, tokenMetrics: null }));
    expect(parseRecordsJson(JSON.stringify(nullMetrics), manifest)).toHaveLength(40);
  });

  test("accepts only verifier-bound token evidence", () => {
    const manifest = parseManifest(createManifestInput());
    const records = createRecordsInput(undefined, () => 0).map((record) => ({ ...record, tokenMetrics: { source: "runtime", scope: "call", tokensOut: 7 } }));
    const evidence = new Map(createRecordsInput().map((record) => [`${record.scenarioId}:${record.profile}`, 7] as const));
    const verifier: TokenMetricVerifier = (claim, binding) => evidence.get(`${binding.scenarioId}:${binding.profile}`) === claim.tokensOut ? claim : null;
    const parsed = parseRecordsJson(JSON.stringify(records), manifest, undefined, verifier);
    expect(parsed.every((record) => record.tokenMetrics?.tokensOut === 7)).toBe(true);
    const mismatch: TokenMetricVerifier = () => null;
    expect(() => parseRecordsJson(JSON.stringify(records), manifest, undefined, mismatch)).toThrow(/verifier|evidence/i);
  });

  test("parses records JSON at the boundary", () => {
    const manifest = parseManifest(createManifestInput());

    expect(parseRecordsJson(JSON.stringify(createRecordsInput()), manifest, undefined, fixtureTokenMetricVerifier)).toHaveLength(40);
    expect(() => parseRecordsJson("{", manifest)).toThrow(/invalid JSON/i);
  });

  test("keeps the complete scenario pairing set visible to callers", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);
    const ids = new Set(records.map((record) => record.scenarioId));

    expect([...ids]).toEqual([...SCENARIO_IDS]);
  });
});
