import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import {
  readProviderAuthSnapshot,
  readProviderOAuthPresence,
  readAuthEntryRaw,
  applyOAuthEntry,
  restoreAuthEntry,
  type AuthSnapshotDeps,
} from "./opencode-auth";
import type { OAuthAuthEntry } from "./openai-oauth";

function deps(result: ExecResult): AuthSnapshotDeps {
  return { execInAiDev: async () => result };
}

function capturingDeps(commands: string[], result: ExecResult): AuthSnapshotDeps {
  return {
    execInAiDev: async (command: string) => {
      commands.push(command);
      return result;
    },
  };
}

describe("readProviderAuthSnapshot", () => {
  test("returns null when the provider credential is absent", async () => {
    // Given
    const reader = deps({ stdout: "{}", stderr: "", exitCode: 0 });

    // When
    const key = await readProviderAuthSnapshot("opencode-go", reader);

    // Then
    expect(key).toBeNull();
  });

  test("returns the stored provider credential", async () => {
    // Given
    const reader = deps({
      stdout: JSON.stringify({ "opencode-go": { type: "api", key: "sk-existing" } }),
      stderr: "",
      exitCode: 0,
    });

    // When
    const key = await readProviderAuthSnapshot("opencode-go", reader);

    // Then
    expect(key).toBe("sk-existing");
  });

  test("rejects when the auth store cannot be read", async () => {
    // Given
    const reader = deps({ stdout: "", stderr: "docker unavailable", exitCode: 1 });

    // When/Then
    await expect(readProviderAuthSnapshot("opencode-go", reader)).rejects.toThrow(
      "Failed to read opencode auth store",
    );
  });
});

describe("readProviderOAuthPresence", () => {
  test("returns true when the entry is an oauth connection", async () => {
    const reader = deps({
      stdout: JSON.stringify({ openai: { type: "oauth", access: "at", refresh: "rt", expires: 1 } }),
      stderr: "",
      exitCode: 0,
    });
    expect(await readProviderOAuthPresence("openai", reader)).toBe(true);
  });

  test("returns false for api entries and absent providers", async () => {
    const reader = deps({
      stdout: JSON.stringify({ openai: { type: "api", key: "sk" } }),
      stderr: "",
      exitCode: 0,
    });
    expect(await readProviderOAuthPresence("openai", reader)).toBe(false);
    expect(await readProviderOAuthPresence("anthropic", reader)).toBe(false);
  });

  test("returns false when the auth store cannot be read", async () => {
    const reader = deps({ stdout: "", stderr: "docker unavailable", exitCode: 1 });
    expect(await readProviderOAuthPresence("openai", reader)).toBe(false);
  });
});

describe("readAuthEntryRaw", () => {
  test("returns the raw entry JSON", async () => {
    const entry = { type: "oauth", access: "at", refresh: "rt", expires: 1 };
    const reader = deps({ stdout: JSON.stringify({ openai: entry }), stderr: "", exitCode: 0 });
    expect(await readAuthEntryRaw("openai", reader)).toBe(JSON.stringify(entry));
  });

  test("returns null when the provider has no entry", async () => {
    const reader = deps({ stdout: "{}", stderr: "", exitCode: 0 });
    expect(await readAuthEntryRaw("openai", reader)).toBeNull();
  });
});

describe("applyOAuthEntry", () => {
  test("writes the entry via an atomic jq rewrite", async () => {
    const commands: string[] = [];
    const entry: OAuthAuthEntry = { type: "oauth", access: "at", refresh: "rt", expires: 1_000 };
    const reader = capturingDeps(commands, { stdout: "", stderr: "", exitCode: 0 });
    await applyOAuthEntry("openai", entry, reader);
    const script = commands[0];
    expect(script).toContain("jq --argjson e");
    expect(script).toContain('.["openai"] = $e');
    expect(script).toContain("base64 -d");
    expect(script).not.toContain('"access":"at"');
    expect(script).toContain("chmod 600");
  });

  test("rejects when the write fails", async () => {
    const reader = deps({ stdout: "", stderr: "jq failed", exitCode: 1 });
    const entry: OAuthAuthEntry = { type: "oauth", access: "at", refresh: "rt", expires: 1_000 };
    await expect(applyOAuthEntry("openai", entry, reader)).rejects.toThrow("jq failed");
  });
});

describe("restoreAuthEntry", () => {
  test("restores a previous raw entry", async () => {
    const commands: string[] = [];
    const reader = capturingDeps(commands, { stdout: "", stderr: "", exitCode: 0 });
    await restoreAuthEntry("openai", '{"type":"api","key":"sk-old"}', reader);
    expect(commands[0]).toContain('.["openai"] = $e');
    expect(commands[0]).toContain("base64 -d");
    expect(commands[0]).not.toContain('"key":"sk-old"');
  });

  test("deletes the entry when the previous snapshot was null", async () => {
    const commands: string[] = [];
    const reader = capturingDeps(commands, { stdout: "", stderr: "", exitCode: 0 });
    await restoreAuthEntry("openai", null, reader);
    expect(commands[0]).toContain('del(.["openai"])');
  });
});
