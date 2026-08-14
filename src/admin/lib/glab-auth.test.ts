import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import { listGlabInstances, normalizeHostname } from "./glab-auth";

function fakeCommand(handler: (command: string) => Partial<ExecResult>): (command: string, timeoutMs: number) => Promise<ExecResult> {
  return async (command) => ({ stdout: "", stderr: "", exitCode: 0, ...handler(command) });
}

describe("glab hostname normalization", () => {
  test("strips scheme and path", () => {
    expect(normalizeHostname("https://gitlab.example.com/")).toBe("gitlab.example.com");
    expect(normalizeHostname("http://gitlab.com")).toBe("gitlab.com");
    expect(normalizeHostname("gitlab.example.com")).toBe("gitlab.example.com");
    expect(normalizeHostname("  gitlab.com  ")).toBe("gitlab.com");
  });
});

describe("glab instances", () => {
  test("lists token-bearing hosts with usernames from auth status", async () => {
    const configYaml = [
      "hosts:",
      "  gitlab.com:",
      "    token: glpat-abc",
      "  gitlab.example.com:",
      "    token: glpat-def",
    ].join("\n");
    const instances = await listGlabInstances(fakeCommand((command) => {
      if (command.includes("config.yml")) return { stdout: "gitlab.com\ngitlab.example.com\n" };
      return { stdout: "Logged in to gitlab.com as alice\nLogged in to gitlab.example.com as bob\n" };
    }));
    expect(instances).toEqual([
      { hostname: "gitlab.com", username: "alice", authenticated: true },
      { hostname: "gitlab.example.com", username: "bob", authenticated: true },
    ]);
  });

  test("returns no instances when no tokens are configured", async () => {
    const instances = await listGlabInstances(fakeCommand(() => ({ stdout: "" })));
    expect(instances).toEqual([]);
  });

  test("never exposes token values in the instance list", async () => {
    const configYaml = [
      "hosts:",
      "  gitlab.com:",
      "    token: glpat-super-secret",
    ].join("\n");
    const instances = await listGlabInstances(fakeCommand((command) => {
      if (command.includes("config.yml")) return { stdout: "gitlab.com\n" };
      return { stdout: "" };
    }));
    expect(JSON.stringify(instances)).not.toContain("glpat-super-secret");
  });
});
