import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import { readProviderAuthSnapshot, type AuthSnapshotDeps } from "./opencode-auth";

function deps(result: ExecResult): AuthSnapshotDeps {
  return { execInAiDev: async () => result };
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
