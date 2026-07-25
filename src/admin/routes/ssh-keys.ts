import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { SshKeysPage } from "../views/ssh-keys";

const sshKeys = new Hono();

interface SshKey {
  name: string;
  fingerprint: string;
  type: string;
}

async function listKeys(): Promise<SshKey[]> {
  const result = await execInAiDev(
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

sshKeys.get("/api/ssh/keys", async (c) => {
  const keys = await listKeys();
  return c.json(keys);
});

sshKeys.post("/api/ssh/keys", async (c) => {
  const body = await c.req.json();
  const name = body.name || "id_ed25519";
  const type = body.type || "ed25519";
  const passphrase = body.passphrase || "";

  let cmd: string;
  if (type === "rsa") {
    cmd = `ssh-keygen -t rsa -b 4096 -f ~/.ssh/${JSON.stringify(name)} -N ${JSON.stringify(passphrase)} -q`;
  } else {
    cmd = `ssh-keygen -t ed25519 -f ~/.ssh/${JSON.stringify(name)} -N ${JSON.stringify(passphrase)} -q`;
  }

  const result = await execInAiDev(cmd, 30_000);
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || "Failed to generate key" }, 500);
  }
  // Auto-register key with SSH agent so it's immediately available
  await execInAiDev(`. ~/.ssh/agent.env 2>/dev/null && ssh-add ~/.ssh/${JSON.stringify(name)} 2>/dev/null || true`, 5_000);
  return c.json({ ok: true });
});

sshKeys.delete("/api/ssh/keys/:name", async (c) => {
  const name = c.req.param("name");
  const result = await execInAiDev(
    `ssh-add -d ~/.ssh/${JSON.stringify(name)} 2>/dev/null; rm -f ~/.ssh/${JSON.stringify(name)} ~/.ssh/${JSON.stringify(name)}.pub; echo ok`,
    15_000,
  );
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || "Failed to delete key" }, 500);
  }
  return c.json({ ok: true });
});

sshKeys.get("/api/ssh/keys/:name/pub", async (c) => {
  const name = c.req.param("name");
  const result = await execInAiDev(`cat ~/.ssh/${JSON.stringify(name)}.pub 2>/dev/null || true`, 10_000);
  if (!result.stdout) {
    return c.json({ error: "Key not found" }, 404);
  }
  return c.text(result.stdout);
});

sshKeys.get("/ssh-keys", async (c) => {
  const keys = await listKeys();
  return c.html(SshKeysPage(keys));
});

export default sshKeys;
