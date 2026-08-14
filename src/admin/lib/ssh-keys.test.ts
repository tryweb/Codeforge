import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import { addKey, deleteKey, isValidKeyName, listKeys } from "./ssh-keys";

function fakeCommand(handler: (command: string) => Partial<ExecResult>): (command: string, timeoutMs: number) => Promise<ExecResult> {
  return async (command) => ({ stdout: "", stderr: "", exitCode: 0, ...handler(command) });
}

describe("ssh key name validation", () => {
  test("accepts safe names and rejects traversal and shell characters", () => {
    expect(isValidKeyName("id_ed25519")).toBe(true);
    expect(isValidKeyName("deploy-key.1")).toBe(true);
    expect(isValidKeyName("../../tmp/evil")).toBe(false);
    expect(isValidKeyName("a;rm")).toBe(false);
    expect(isValidKeyName("a b")).toBe(false);
    expect(isValidKeyName("..")).toBe(false);
    expect(isValidKeyName("/etc/passwd")).toBe(false);
  });
});

describe("ssh key commands", () => {
  test("addKey rejects an unsafe name before running any command", async () => {
    let ran = false;
    const result = await addKey("../../tmp/evil", "ed25519", "", fakeCommand(() => { ran = true; return {}; }));
    expect(result.ok).toBe(false);
    expect(ran).toBe(false);
  });

  test("addKey generates an ed25519 key and registers it with the ssh agent", async () => {
    const commands: string[] = [];
    const result = await addKey("deploy", "ed25519", "pass", fakeCommand((command) => {
      commands.push(command);
      return {};
    }));
    expect(result).toEqual({ ok: true });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("ssh-keygen -t ed25519 -f ~/.ssh/\"deploy\"");
    expect(commands[1]).toContain("ssh-add");
  });

  test("addKey uses rsa 4096 when requested", async () => {
    const commands: string[] = [];
    await addKey("rsa-key", "rsa", "", fakeCommand((command) => {
      commands.push(command);
      return {};
    }));
    expect(commands[0]).toContain("ssh-keygen -t rsa -b 4096");
  });

  test("addKey reports generation failure", async () => {
    const result = await addKey("deploy", "ed25519", "", fakeCommand(() => ({ exitCode: 1, stderr: "boom" })));
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  test("deleteKey removes the key pair and drops it from the agent", async () => {
    const commands: string[] = [];
    const result = await deleteKey("deploy", fakeCommand((command) => {
      commands.push(command);
      return {};
    }));
    expect(result).toEqual({ ok: true });
    expect(commands[0]).toContain("ssh-add -d");
    expect(commands[0]).toContain("rm -f");
  });

  test("listKeys parses fingerprints and types", async () => {
    const result = await listKeys(fakeCommand(() => ({
      stdout: "id_ed25519\t256 SHA256:abcXYZ comment (ED25519)\ndeploy\t4096 SHA256:def comment (RSA)\n",
    })));
    expect(result).toEqual([
      { name: "id_ed25519", fingerprint: "256 SHA256:abcXYZ comment (ED25519)", type: "Ed25519" },
      { name: "deploy", fingerprint: "4096 SHA256:def comment (RSA)", type: "RSA" },
    ]);
  });
});
