import { describe, expect, test } from "bun:test";
import { filterToSchema, LEANCTX_SCHEMA } from "./leanctx-schema";

describe("filterToSchema", () => {
  test("removes unsupported legacy keys while preserving supported nested keys", () => {
    const filtered = filterToSchema({
      tool_profile: "power",
      tools: { profile: "minimal" },
      budget: { information_gate: { enabled: true } },
      archive: { enabled: false },
    });

    expect(filtered).toEqual({
      tool_profile: "power",
      archive: { enabled: false },
    });
  });
});

describe("lean-ctx v3.9.20 compatibility", () => {
  test("exposes the supported secret redaction controls without inert issue 68 keys", () => {
    const keys = new Set(LEANCTX_SCHEMA.map((entry) => entry.key));

    expect(keys.has("secret_detection.enabled")).toBe(true);
    expect(keys.has("secret_detection.redact")).toBe(true);
    expect(keys.has("secret_detection.redact_in_archive")).toBe(false);
    expect(keys.has("loop_detection.enabled")).toBe(false);
    expect(keys.has("proxy.enabled")).toBe(false);
    expect(keys.has("cognitive_mode")).toBe(false);
    expect(keys.has("search.candidate_count")).toBe(false);
    expect(keys.has("loop_detection.max_calls_per_tool")).toBe(false);
    expect(keys.has("loop_detection.max_total_calls")).toBe(false);
    expect(keys.has("boundary_policy.universal_gotchas")).toBe(false);
    expect(keys.has("proxy.port")).toBe(false);
  });

  test("filters inert issue 68 keys while retaining supported secret controls", () => {
    const filtered = filterToSchema({
      cognitive_mode: "full",
      search: { candidate_count: 100 },
      loop_detection: { enabled: true, max_calls_per_tool: 50, max_total_calls: 200 },
      boundary_policy: { universal_gotchas: false },
      proxy: { enabled: false, port: 4444 },
      secret_detection: { enabled: true, redact: true, redact_in_archive: true },
    });

    expect(filtered).toEqual({
      secret_detection: { enabled: true, redact: true },
    });
  });
});

describe("compression defaults", () => {
  test("uses the lite baseline", () => {
    const compression = LEANCTX_SCHEMA.find((entry) => entry.key === "compression_level");

    expect(compression?.default).toBe("lite");
  });
});
