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
    expect(validateFallbackModels({ entries: [] })).toBeNull();
  });

  test("rejects multiple entries because only one primary model is supported", () => {
    expect(
      validateFallbackModels({
        entries: [{ model: "openai/gpt-5.6-sol" }, { model: "opencode/big-pickle" }],
      }),
    ).toContain("at most one");
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

  test("accepts multi-segment catalog ids such as nvidia/<org>/<model>", () => {
    expect(validateFallbackModels({ entries: [{ model: "nvidia/google/gemma-3-12b-it" }] })).toBeNull();
    expect(validateFallbackModels({ entries: [{ model: "nvidia/meta/llama-guard-4-12b", variant: "high" }] })).toBeNull();
  });

  test("still rejects malformed references under the relaxed pattern", () => {
    expect(validateFallbackModels({ entries: [{ model: "/leading-slash/model" }] })).toContain("provider/model");
    expect(validateFallbackModels({ entries: [{ model: "provider/" }] })).toContain("provider/model");
    expect(validateFallbackModels({ entries: [{ model: "pro vider/model" }] })).toContain("provider/model");
    expect(validateFallbackModels({ entries: [{ model: "provider/mod el" }] })).toContain("provider/model");
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
    expect(command).not.toContain("$schema");
    expect(command).not.toContain(".agents[$agent].other");
  });

  test("shell-quotes model values containing apostrophes", () => {
    const command = buildJqWriteCommand("explore", [{ model: "provider/model'; echo pwn" }]);

    expect(command).toContain(`--arg model 'provider/model'"'"'; echo pwn'`);
  });

  test("clear case removes all model keys without changing sibling settings", () => {
    const command = buildJqWriteCommand("explore", []);
    expect(command).toContain(
      `del(.agents[$agent].model, .agents[$agent].variant, .agents[$agent].models, .agents[$agent].fallback_models)`,
    );
    expect(command).not.toContain(".agents[$agent].permission");
    expect(command).not.toContain("$schema");
    expect(command).not.toContain(".agents[$agent].other");
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
