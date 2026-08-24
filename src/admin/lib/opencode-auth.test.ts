import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import {
  applyOAuthEntry,
  readAuthEntryRaw,
  readProviderAuthSnapshot,
  readProviderOAuthPresence,
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
    const reader = deps({ stdout: "{}", stderr: "", exitCode: 0 });

    const result = await readProviderAuthSnapshot("openai", reader);

    expect(result).toBeNull();
  });

  test("returns the stored provider credential", async () => {
    const reader = deps({
      stdout: JSON.stringify({ "opencode-go": { type: "api", key: "sk-existing" } }),
      stderr: "",
      exitCode: 0,
    });

    const result = await readProviderAuthSnapshot("opencode-go", reader);

    expect(result).toBe("sk-existing");
  });

  test("rejects when the auth store cannot be read", async () => {
    const reader = deps({ stdout: "", stderr: "docker unavailable", exitCode: 1 });

    await expect(readProviderAuthSnapshot("openai", reader)).rejects.toThrow(
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

    const result = await readProviderOAuthPresence("openai", reader);

    expect(result).toBe(true);
  });

  test("returns false for api entries and absent providers", async () => {
    const reader = deps({
      stdout: JSON.stringify({ openai: { type: "api", key: "sk" } }),
      stderr: "",
      exitCode: 0,
    });

    expect(await readProviderOAuthPresence("openai", reader)).toBe(false);
    expect(await readProviderOAuthPresence("missing", reader)).toBe(false);
  });

  test("returns false when the auth store cannot be read", async () => {
    const reader = deps({ stdout: "", stderr: "docker unavailable", exitCode: 1 });

    expect(await readProviderOAuthPresence("openai", reader)).toBe(false);
  });

  test("returns false when the auth store contains invalid JSON", async () => {
    const reader = deps({ stdout: "not-json", stderr: "", exitCode: 0 });

    expect(await readProviderOAuthPresence("openai", reader)).toBe(false);
  });
});

describe("readAuthEntryRaw", () => {
  test("returns the raw entry JSON", async () => {
    const entry = { type: "oauth", access: "at", refresh: "rt", expires: 1 };
    const reader = deps({ stdout: JSON.stringify({ openai: entry }), stderr: "", exitCode: 0 });

    const result = await readAuthEntryRaw("openai", reader);

    expect(result).toBe(JSON.stringify(entry));
  });

  test("returns null when the provider has no entry", async () => {
    const reader = deps({ stdout: "{}", stderr: "", exitCode: 0 });

    expect(await readAuthEntryRaw("openai", reader)).toBeNull();
  });
});

describe("applyOAuthEntry", () => {
  test("writes the entry via an atomic jq rewrite", async () => {
    const entry: OAuthAuthEntry = { type: "oauth", access: "at", refresh: "rt", expires: 1_000 };
    const commands: string[] = [];
    const writer = capturingDeps(commands, { stdout: "", stderr: "", exitCode: 0 });

    await applyOAuthEntry("openai", entry, writer);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("jq --argjson e");
    expect(commands[0]).toContain(".\[\"openai\"\] = $e");
  });

  test("rejects when the write fails", async () => {
    const entry: OAuthAuthEntry = { type: "oauth", access: "at", refresh: "rt", expires: 1_000 };
    const writer = deps({ stdout: "", stderr: "jq failed", exitCode: 1 });

    await expect(applyOAuthEntry("openai", entry, writer)).rejects.toThrow("jq failed");
  });

  test("executes repeated writes independently and surfaces a later failure", async () => {
    const firstEntry: OAuthAuthEntry = { type: "oauth", access: "at-1", refresh: "rt-1", expires: 1_000 };
    const secondEntry: OAuthAuthEntry = { type: "oauth", access: "at-2", refresh: "rt-2", expires: 2_000 };
    const commands: string[] = [];
    let writeCount = 0;
    const writer: AuthSnapshotDeps = {
      execInAiDev: async (command: string) => {
        commands.push(command);
        writeCount += 1;
        return writeCount === 1
          ? { stdout: "", stderr: "", exitCode: 0 }
          : { stdout: "", stderr: "second write failed", exitCode: 1 };
      },
    };

    await applyOAuthEntry("openai", firstEntry, writer);
    await expect(applyOAuthEntry("openai", secondEntry, writer)).rejects.toThrow("second write failed");

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain(Buffer.from(JSON.stringify(firstEntry)).toString("base64"));
    expect(commands[1]).toContain(Buffer.from(JSON.stringify(secondEntry)).toString("base64"));
  });
});

describe("restoreAuthEntry", () => {
  test("restores a previous raw entry", async () => {
    const commands: string[] = [];
    const writer = capturingDeps(commands, { stdout: "", stderr: "", exitCode: 0 });

    await restoreAuthEntry("openai", '{"type":"api","key":"sk-old"}', writer);

    expect(commands[0]).toContain(".\[\"openai\"\] = $e");
  });

  test("deletes the entry when the previous snapshot was null", async () => {
    const commands: string[] = [];
    const writer = capturingDeps(commands, { stdout: "", stderr: "", exitCode: 0 });

    await restoreAuthEntry("openai", null, writer);

    expect(commands[0]).toContain("del(.\[\"openai\"\])");
  });
});
