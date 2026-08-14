import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import { readGlobalConfig, readSanitizedGlobalConfig, setGlobalConfig } from "./git-config";

function fakeCommand(stdout: string): (command: string, timeoutMs: number) => Promise<ExecResult> {
  return async () => ({ stdout, stderr: "", exitCode: 0 });
}

const SAMPLE_CONFIG = [
  "user.name=Alice",
  "user.email=alice@example.com",
  "credential.https://gitlab.example.com.helper=glab",
  "url.https://token@github.com/.insteadOf=https://github.com/",
  "http.extraheader=Authorization: Bearer ghp_abc123",
].join("\n");

describe("git config reads", () => {
  test("readGlobalConfig returns the raw config", async () => {
    const config = await readGlobalConfig(fakeCommand(SAMPLE_CONFIG));
    expect(config).toEqual({
      "user.name": "Alice",
      "user.email": "alice@example.com",
      "credential.https://gitlab.example.com.helper": "glab",
      "url.https://token@github.com/.insteadOf": "https://github.com/",
      "http.extraheader": "Authorization: Bearer ghp_abc123",
    });
  });

  test("readSanitizedGlobalConfig drops credential and url sections and masks key-like values", async () => {
    const config = await readSanitizedGlobalConfig(fakeCommand(SAMPLE_CONFIG));
    expect(Object.keys(config).sort()).toEqual(["http.extraheader", "user.email", "user.name"]);
    expect(config["user.name"]).toBe("Alice");
    expect(config["http.extraheader"]).toMatch(/^Auth…c123$/);
  });
});

describe("git config set", () => {
  test("setGlobalConfig runs git config --global", async () => {
    let ran = "";
    const result = await setGlobalConfig("user.email", "bob@example.com", async (command) => {
      ran = command;
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    expect(result).toEqual({ ok: true });
    expect(ran).toContain("git config --global \"user.email\" \"bob@example.com\"");
  });
});
