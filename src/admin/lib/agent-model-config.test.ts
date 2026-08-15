import { describe, expect, test } from "bun:test";
import {
  buildJqWriteCommand,
  displayNameToKey,
  OMO_CONFIG,
  validateFallbackModels,
} from "./agent-models";

describe("validateFallbackModels", () => {
  test("accepts valid entries with and without variant", () => {
    expect(validateFallbackModels({ entries: [{ model: "opencode/big-pickle" }] })).toBeNull();
    expect(validateFallbackModels({ entries: [{ model: "openai/gpt-5.6-sol", variant: "max" }] })).toBeNull();
  });

  test("rejects non-object bodies", () => {
    expect(validateFallbackModels(null)).toContain("JSON object");
    expect(validateFallbackModels("x")).toContain("JSON object");
    expect(validateFallbackModels([])).toContain("JSON object");
  });

  test("rejects non-array entries", () => {
    expect(validateFallbackModels({ entries: "nope" })).toContain("entries must be an array");
  });

  test("rejects missing or non-string model", () => {
    expect(validateFallbackModels({ entries: [{}] })).toContain("non-empty string model");
    expect(validateFallbackModels({ entries: [{ model: 42 }] })).toContain("non-empty string model");
    expect(validateFallbackModels({ entries: [{ model: "" }] })).toContain("non-empty string model");
  });

  test("rejects invalid variant", () => {
    expect(validateFallbackModels({ entries: [{ model: "opencode/big-pickle", variant: "turbo" }] })).toContain(
      "variant must be one of",
    );
  });

  test("rejects model ids without a provider", () => {
    expect(validateFallbackModels({ entries: [{ model: "big-pickle" }] })).toContain("provider/model");
  });
});

describe("buildJqWriteCommand", () => {
  test("delete case drops only model keys without changing sibling settings", () => {
    const command = buildJqWriteCommand("sisyphus", []);
    expect(command).toContain(
      `del(.agents[$agent].model, .agents[$agent].variant, .agents[$agent].models, .agents[$agent].fallback_models)`,
    );
    expect(command).not.toContain(".agents[$agent].permission");
    expect(command).toContain(`mv /tmp/omo.jsonc.tmp ${OMO_CONFIG}`);
    expect(command).not.toContain("base64");
  });

  test("single-entry case writes the model string plus variant", () => {
    const command = buildJqWriteCommand("sisyphus-junior", [{ model: "gpt-5.6-sol", variant: "medium" }]);
    expect(command).toContain(`--arg agent 'sisyphus-junior'`);
    expect(command).toContain(`--arg model 'gpt-5.6-sol'`);
    expect(command).toContain(`.agents[$agent].model = $model`);
    expect(command).toContain(`.agents[$agent].variant = "medium"`);
    expect(command).toContain(`del(.agents[$agent].models, .agents[$agent].fallback_models)`);
    expect(command).not.toContain(".agents[$agent].permission");
  });

  test("chain case writes only the primary model", () => {
    const command = buildJqWriteCommand("explore", [
      { model: "gpt-5.6-sol", variant: "high" },
      { model: "kimi-k3" },
    ]);
    expect(command).toContain(`--arg model 'gpt-5.6-sol'`);
    expect(command).toContain(`.agents[$agent].model = $model`);
    expect(command).toContain(`.agents[$agent].variant = "high"`);
    expect(command).toContain(`del(.agents[$agent].models, .agents[$agent].fallback_models)`);
    expect(command).not.toContain(".agents[$agent].permission");
    expect(command).not.toContain("kimi-k3");
  });
});

describe("displayNameToKey", () => {
  const keys = new Set(["sisyphus", "plan", "explore", "sisyphus-junior", "oracle"]);

  test("maps role display names to config keys", () => {
    expect(displayNameToKey("Sisyphus - ultraworker", keys)).toBe("sisyphus");
    expect(displayNameToKey("Sisyphus-Junior", keys)).toBe("sisyphus-junior");
  });

  test("passes plain display names through unchanged", () => {
    expect(displayNameToKey("plan", keys)).toBe("plan");
    expect(displayNameToKey("oracle", keys)).toBe("oracle");
  });

  test("returns null for unknown built-ins", () => {
    expect(displayNameToKey("build", keys)).toBeNull();
    expect(displayNameToKey("compaction", keys)).toBeNull();
  });
});
