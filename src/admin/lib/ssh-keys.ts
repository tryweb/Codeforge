import { execInAiDev, type ExecResult } from "./docker";

export type SshCommand = (command: string, timeoutMs: number) => Promise<ExecResult>;

export interface SshKey {
  name: string;
  fingerprint: string;
  type: string;
}

/** Allow only safe key file names: no path separators, traversal, or shell-active characters. */
export function isValidKeyName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

export async function listKeys(command: SshCommand = execInAiDev): Promise<SshKey[]> {
  const result = await command(
    "for f in ~/.ssh/*.pub; do [ -f \"$f\" ] && echo \"$(basename $f .pub)\t$(ssh-keygen -lf $f 2>/dev/null | head -1)\"; done",
    15_000,
  );
  const keys: SshKey[] = [];
  for (const line of result.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const fingerprint = parts.slice(1).join(" ").trim();
      const type = fingerprint.includes("ED25519") ? "Ed25519" : fingerprint.includes("RSA") ? "RSA" : "unknown";
      keys.push({ name: parts[0], fingerprint, type });
    }
  }
  return keys;
}

export async function addKey(
  name: string,
  type: string,
  passphrase: string,
  command: SshCommand = execInAiDev,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeName = name || "id_ed25519";
  if (!isValidKeyName(safeName)) {
    return { ok: false, error: "Invalid key name: use letters, digits, dots, underscores and dashes only" };
  }

  let cmd: string;
  if (type === "rsa") {
    cmd = `ssh-keygen -t rsa -b 4096 -f ~/.ssh/${JSON.stringify(safeName)} -N ${JSON.stringify(passphrase)} -q`;
  } else {
    cmd = `ssh-keygen -t ed25519 -f ~/.ssh/${JSON.stringify(safeName)} -N ${JSON.stringify(passphrase)} -q`;
  }

  const result = await command(cmd, 30_000);
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || "Failed to generate key" };
  }
  // Auto-register key with SSH agent so it's immediately available
  await command(`. ~/.ssh/agent.env 2>/dev/null && ssh-add ~/.ssh/${JSON.stringify(safeName)} 2>/dev/null || true`, 5_000);
  return { ok: true };
}

export async function deleteKey(
  name: string,
  command: SshCommand = execInAiDev,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidKeyName(name)) {
    return { ok: false, error: "Invalid key name: use letters, digits, dots, underscores and dashes only" };
  }
  const result = await command(
    `ssh-add -d ~/.ssh/${JSON.stringify(name)} 2>/dev/null; rm -f ~/.ssh/${JSON.stringify(name)} ~/.ssh/${JSON.stringify(name)}.pub; echo ok`,
    15_000,
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || "Failed to delete key" };
  }
  return { ok: true };
}

export async function getPublicKey(name: string, command: SshCommand = execInAiDev): Promise<string> {
  if (!isValidKeyName(name)) return "";
  const result = await command(`cat ~/.ssh/${JSON.stringify(name)}.pub 2>/dev/null || true`, 10_000);
  return result.stdout;
}
