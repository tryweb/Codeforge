import { describe, expect, test } from "bun:test";
import { filterToSchema } from "./leanctx-schema";

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
