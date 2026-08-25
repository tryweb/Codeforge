import { describe, expect, test } from "bun:test";
import { parseManifest } from "./parse-manifest";
import { runTodo6Gates } from "./todo6-gates";
import { createManifestInput, createRecordsInput } from "./test-support";

const manifest = parseManifest(createManifestInput());

describe("Todo 6 machine gates", () => {
  test("G3 passes the complete paired normalized input", () => {
    const records = createRecordsInput();
    expect(runTodo6Gates(manifest, records).g3.passed).toBe(true);
  });

  test("G4 accepts perfect retain and valid disable-routing outcomes", () => {
    const perfect = createRecordsInput();
    expect(runTodo6Gates(manifest, perfect).g4.passed).toBe(true);
    const unavailable = createRecordsInput(undefined, () => 0).map((record) => ({ ...record, tokenMetrics: null }));
    expect(runTodo6Gates(manifest, unavailable).g4.passed).toBe(true);
    const incident = createRecordsInput().map((record, index) => index === 0 ? { ...record, incidents: ["marker"] as const } : record);
    expect(runTodo6Gates(manifest, incident).g4.passed).toBe(true);
  });

  test("G4 ignores a forged precomputed retain evaluation", () => {
    const unavailable = createRecordsInput(undefined, () => 0).map((record) => ({ ...record, tokenMetrics: null }));
    const forged = { get verdict(): never { throw new Error("forged evaluation used"); } };
    expect(() => Reflect.apply(runTodo6Gates, undefined, [manifest, unavailable, forged])).not.toThrow();
  });

  test("G3 rejects partial input", () => {
    const partial = createRecordsInput().slice(0, 39);
    expect(runTodo6Gates(manifest, partial).g3.passed).toBe(false);
  });

  test("G3 rejects typed manifests forged after parsing", () => {
    const records = createRecordsInput();
    const mutations = [
      { ...manifest, profiles: ["comparison", "lossless"] as const },
      { ...manifest, gates: ["G0", "G1", "G2", "G3"] as const },
      { ...manifest, scenarios: manifest.scenarios.map((scenario, index) => index === 0 ? { ...scenario, category: "forged" } : scenario) },
      { ...manifest, scenarios: manifest.scenarios.map((scenario, index) => index === 0 ? { ...scenario, command: "printf forged" } : scenario) },
    ];
    for (const forged of mutations) {
      const gates = Reflect.apply(runTodo6Gates, undefined, [forged, records]);
      expect(gates.g3.passed).toBe(false);
    }
  });
});
