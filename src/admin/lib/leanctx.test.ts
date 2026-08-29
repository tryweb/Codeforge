import { describe, expect, test } from "bun:test";
import { parse } from "smol-toml";
import {
  applyLeanCtxConfig,
  expandDottedKeys,
  mergeConfigIntoToml,
  mergeLeanCtxConfig,
  parseLeanCtxToml,
  resetLeanCtxConfig,
  serializeLeanCtxConfig,
  type LeanCtxApplyDeps,
} from "./leanctx";
import type { ExecResult } from "./docker";

function assignmentKeys(toml: string): string[] {
  return toml
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("["))
    .map((l) => l.split("=")[0].trim());
}

describe("mergeConfigIntoToml", () => {
  test("returns null when the raw TOML is non-empty but fails to parse", () => {
    // `shell_allowlist_extra = []` followed by bare array items is invalid
    // TOML, so parseTomlSafe returns {} and every key would be appended as a
    // duplicate of its original line.
    const corrupted = [
      "# lean-ctx ai-engkit tuning",
      'compression_level = "max"',
      "shell_allowlist_extra = []",
      '    "gh",',
      '    "bun",',
      "]",
      'cognitive_mode = "full"',
    ].join("\n");
    const config = {
      compression_level: "max",
      cognitive_mode: "full",
      shell_allowlist_extra: ["gh", "bun"],
    };
    expect(mergeConfigIntoToml(corrupted, config)).toBeNull();
  });

  test("does not append keys that already appear in the raw TOML", () => {
    const raw = [
      "# keep me",
      'compression_level = "lite"',
      "archive.enabled = true",
      "archive.threshold_chars = 800",
    ].join("\n");
    const config = {
      compression_level: "max",
      "archive.enabled": true,
      "archive.threshold_chars": 800,
    };
    const merged = mergeConfigIntoToml(raw, config);
    expect(merged).not.toBeNull();
    const keys = assignmentKeys(merged as string);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
    expect(parse(merged as string)).toEqual({
      compression_level: "max",
      archive: { enabled: true, threshold_chars: 800 },
    });
  });

  test("preserves comments, section headers, and multi-line arrays", () => {
    const raw = [
      "# top comment",
      'compression_level = "lite"',
      "shell_allowlist_extra = [",
      '    "gh",',
      '    "bun",',
      "]",
      "",
      "[gain]",
      'last_auto_publish = "2026-08-20T00:00:00Z"',
    ].join("\n");
    const config = {
      compression_level: "max",
      shell_allowlist_extra: ["gh", "bun", "docker"],
    };
    const merged = mergeConfigIntoToml(raw, config);
    expect(merged).not.toBeNull();
    expect((merged as string).includes("# top comment")).toBe(true);
    expect((merged as string).includes("[gain]")).toBe(true);
    expect((merged as string).includes('last_auto_publish = "2026-08-20T00:00:00Z"')).toBe(true);
    const occurrences = (merged as string).match(/shell_allowlist_extra/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(parse(merged as string)).toEqual({
      compression_level: "max",
      shell_allowlist_extra: ["gh", "bun", "docker"],
      gain: { last_auto_publish: "2026-08-20T00:00:00Z" },
    });
  });

  test("still appends genuinely new keys", () => {
    const raw = "# only a comment\ncompression_level = \"lite\"\n";
    const config = { compression_level: "max", cognitive_mode: "full" };
    const merged = mergeConfigIntoToml(raw, config);
    expect(merged).not.toBeNull();
    expect((merged as string).includes('cognitive_mode = "full"')).toBe(true);
    expect(parse(merged as string)).toEqual({ compression_level: "max", cognitive_mode: "full" });
  });

  test("comment-only raw TOML still merges instead of falling back", () => {
    const raw = "# lean-ctx ai-engkit tuning\n";
    const config = { compression_level: "max" };
    const merged = mergeConfigIntoToml(raw, config);
    expect(merged).not.toBeNull();
    expect((merged as string).includes("# lean-ctx ai-engkit tuning")).toBe(true);
    expect((merged as string).includes('compression_level = "max"')).toBe(true);
  });
});

describe("LeanCTX config lifecycle", () => {
  test("reports malformed TOML instead of treating it as an empty config", () => {
    const result = parseLeanCtxToml("broken = [", "/tmp/config.toml");

    expect(result.config).toEqual({});
    expect(result.parseError).toContain("/tmp/config.toml is malformed TOML");
  });

  test("merges baseline and global values in precedence order", () => {
    const merged = mergeLeanCtxConfig(
      { compression_level: "lite", archive: { enabled: true } },
      { compression_level: "max" },
    );

    expect(merged).toEqual({ compression_level: "max", archive: { enabled: true } });
  });
});

describe("expandDottedKeys", () => {
  test("expands flat dotted keys into nested objects", () => {
    expect(expandDottedKeys({ "archive.enabled": true, "archive.threshold_chars": 800 })).toEqual({
      archive: { enabled: true, threshold_chars: 800 },
    });
  });

  test("resolves scalar/table collisions deterministically regardless of key order", () => {
    expect(expandDottedKeys({ a: 1, "a.b": 2 })).toEqual({ a: { b: 2 } });
    expect(expandDottedKeys({ "a.b": 2, a: 1 })).toEqual({ a: { b: 2 } });
  });

  test("merges dotted keys into an existing nested object without mutating the input", () => {
    const input = { archive: { enabled: true }, "archive.threshold_chars": 800 };

    const expanded = expandDottedKeys(input);

    expect(expanded).toEqual({ archive: { enabled: true, threshold_chars: 800 } });
    expect(input).toEqual({ archive: { enabled: true }, "archive.threshold_chars": 800 });
  });
});

describe("serializeLeanCtxConfig", () => {
  test("round-trips flat dotted schema keys as nested TOML tables", () => {
    const toml = serializeLeanCtxConfig({
      compression_level: "max",
      "archive.enabled": true,
      "archive.threshold_chars": 800,
    });

    expect(toml).not.toContain('"archive.enabled"');
    expect(parse(toml)).toEqual({
      compression_level: "max",
      archive: { enabled: true, threshold_chars: 800 },
    });
  });

  test("keeps nested input nested and drops keys outside the schema", () => {
    const toml = serializeLeanCtxConfig({
      compression_level: "max",
      archive: { enabled: false },
      autonomy: { enabled: true },
    });

    expect(parse(toml)).toEqual({ compression_level: "max", archive: { enabled: false } });
  });
});

describe("resetLeanCtxConfig", () => {
  test("writes the baseline as a full replacement, dropping prior global keys", async () => {
    // A prior global holding archive.enabled/autonomy.* overrides must not
    // survive: reset serializes the baseline alone instead of merging into
    // the existing file the way writeLeanCtxConfig does.
    const written: string[] = [];

    const result = await resetLeanCtxConfig(
      { compression_level: "lite" },
      { writeFile: async (_path, content) => { written.push(content); return true; } },
    );

    expect(result).toEqual({ ok: true });
    expect(parse(written[0])).toEqual({ compression_level: "lite" });
    expect(written[0]).not.toContain("archive");
    expect(written[0]).not.toContain("autonomy");
  });

  test("serializes baseline dotted keys as nested tables", async () => {
    const written: string[] = [];

    await resetLeanCtxConfig(
      { "archive.enabled": true },
      { writeFile: async (_path, content) => { written.push(content); return true; } },
    );

    expect(written[0]).not.toContain('"archive.enabled"');
    expect(parse(written[0])).toEqual({ archive: { enabled: true } });
  });

  test("reports a write failure", async () => {
    const result = await resetLeanCtxConfig({}, { writeFile: async () => false });

    expect(result).toEqual({ ok: false, error: "Failed to write lean-ctx config in ai-dev" });
  });
});

// The fixture deliberately hands applyLeanCtxConfig a restart-capable object:
// the exec-only contract is proven by asserting restart and sleep are never
// invoked even though they are available.
function createApplyFixture(options: { readonly apply?: ExecResult } = {}): {
  readonly deps: LeanCtxApplyDeps;
  readonly calls: readonly string[];
  readonly sleepCalls: readonly number[];
  readonly restartCalls: () => number;
} {
  const calls: string[] = [];
  const sleepCalls: number[] = [];
  let restartCalls = 0;

  const deps = {
    exec: async (command: string, _timeoutMs?: number): Promise<ExecResult> => {
      calls.push(command);
      return options.apply ?? { stdout: "applied", stderr: "", exitCode: 0 };
    },
    restart: async () => {
      restartCalls += 1;
      return { ok: true };
    },
    sleep: async (delayMs: number) => {
      sleepCalls.push(delayMs);
    },
  };

  return {
    deps,
    calls,
    sleepCalls,
    restartCalls: () => restartCalls,
  };
}

describe("applyLeanCtxConfig", () => {
  test("runs lean-ctx config apply exec-only and reports success", async () => {
    const fixture = createApplyFixture();

    const result = await applyLeanCtxConfig(fixture.deps);

    expect(result).toEqual({ ok: true, output: "applied" });
    expect(fixture.calls).toEqual(["lean-ctx config apply 2>&1"]);
    expect(fixture.restartCalls()).toBe(0);
    expect(fixture.sleepCalls).toEqual([]);
  });

  test("reports the failure output without restarting or sleeping", async () => {
    const fixture = createApplyFixture({ apply: { stdout: "", stderr: "apply boom", exitCode: 1 } });

    const result = await applyLeanCtxConfig(fixture.deps);

    expect(result).toEqual({ ok: false, output: "apply boom", error: "apply boom" });
    expect(fixture.calls).toEqual(["lean-ctx config apply 2>&1"]);
    expect(fixture.restartCalls()).toBe(0);
    expect(fixture.sleepCalls).toEqual([]);
  });
});
