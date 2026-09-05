import { Hono } from "hono";
import { addKey, deleteKey, getPublicKey, listKeys } from "../lib/ssh-keys";
import { SshKeysPage } from "../views/ssh-keys";

const sshKeys = new Hono();

sshKeys.get("/api/ssh/keys", async (c) => {
  const keys = await listKeys();
  return c.json(keys);
});

sshKeys.post("/api/ssh/keys", async (c) => {
  const body = await c.req.json();
  const name = body.name || "id_ed25519";
  const type = body.type || "ed25519";
  const passphrase = body.passphrase || "";

  const result = await addKey(name, type, passphrase);
  if ("error" in result) {
    const status = result.error.startsWith("Invalid key name") ? 400 : 500;
    return c.json({ error: result.error }, status);
  }
  return c.json({ ok: true });
});

sshKeys.delete("/api/ssh/keys/:name", async (c) => {
  const name = c.req.param("name");
  const result = await deleteKey(name);
  if ("error" in result) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ ok: true });
});

sshKeys.get("/api/ssh/keys/:name/pub", async (c) => {
  const name = c.req.param("name");
  const pub = await getPublicKey(name);
  if (!pub) {
    return c.json({ error: "Key not found" }, 404);
  }
  return c.text(pub);
});

sshKeys.get("/ssh-keys", async (c) => {
  const keys = await listKeys();
  return c.html(SshKeysPage(keys));
});

export default sshKeys;
