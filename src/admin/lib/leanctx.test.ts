import { describe, expect, test } from "bun:test";
import { parse } from "smol-toml";
import {
  applyLeanCtxConfig,
  mergeConfigIntoToml,
  mergeLeanCtxConfig,
  parseLeanCtxToml,
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

  test("merges baseline, runtime, and project values in precedence order", () => {
    const merged = mergeLeanCtxConfig(
      { compression_level: "lite", archive: { enabled: true } },
      { compression_level: "max" },
      { archive: { enabled: false } },
    );

    expect(merged).toEqual({ compression_level: "max", archive: { enabled: false } });
  });
});

type ApplyFixtureOptions = {
  readonly apply?: ExecResult;
  readonly doctors?: readonly ExecResult[];
  readonly restart?: { readonly ok: boolean; readonly error?: string };
};

function createApplyFixture(options: ApplyFixtureOptions = {}): {
  readonly deps: LeanCtxApplyDeps;
  readonly calls: readonly string[];
  readonly sleepCalls: readonly number[];
  readonly restartCalls: number;
} {
  const calls: string[] = [];
  const sleepCalls: number[] = [];
  let restartCalls = 0;
  const doctors = [...(options.doctors ?? [])];

  const deps: LeanCtxApplyDeps = {
    exec: async (command, _timeoutMs): Promise<ExecResult> => {
      calls.push(command);
      if (command.startsWith("lean-ctx config apply")) {
        return options.apply ?? { stdout: "applied", stderr: "", exitCode: 0 };
      }
      return doctors.shift() ?? { stdout: "daemon is not running", stderr: "", exitCode: 1 };
    },
    restart: async () => {
      restartCalls += 1;
      return options.restart ?? { ok: true };
    },
    sleep: async (delayMs) => {
      sleepCalls.push(delayMs);
    },
  };

  return {
    deps,
    calls,
    sleepCalls,
    get restartCalls() {
      return restartCalls;
    },
  };
}

describe("applyLeanCtxConfig", () => {
  test("reports apply_failed and does not restart when config apply fails", async () => {
    const fixture = createApplyFixture({ apply: { stdout: "apply failed", stderr: "", exitCode: 1 } });

    const result = await applyLeanCtxConfig(fixture.deps);

    expect(result).toEqual({ ok: false, status: "apply_failed", output: "apply failed", error: "apply failed" });
    expect(fixture.calls).toEqual(["lean-ctx config apply 2>&1"]);
  });

  test("reports restart_failed without checking the daemon when restart fails", async () => {
    const fixture = createApplyFixture({ restart: { ok: false, error: "compose failed" } });

    const result = await applyLeanCtxConfig(fixture.deps);

    expect(result).toEqual({ ok: false, status: "restart_failed", output: "applied", error: "compose failed" });
    expect(fixture.calls).toEqual(["lean-ctx config apply 2>&1"]);
  });

  test("reports applied after config apply and container restart succeed", async () => {
    const fixture = createApplyFixture();

    const result = await applyLeanCtxConfig(fixture.deps);

    expect(result).toEqual({ ok: true, status: "applied", output: "applied" });
    expect(fixture.calls).toEqual(["lean-ctx config apply 2>&1"]);
    expect(fixture.sleepCalls).toEqual([]);
    expect(fixture.restartCalls).toBe(1);
  });

});
