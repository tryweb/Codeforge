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

describe("compression defaults", () => {
  test("uses an explicit lossless default", () => {
    const compression = LEANCTX_SCHEMA.find((entry) => entry.key === "compression_level");

    expect(compression?.default).toBe("off");
  });
});
