import { Hono } from "hono";
import { readGlobalConfig, setGlobalConfig } from "../lib/git-config";

const gitConfig = new Hono();

gitConfig.get("/api/git/config", async (c) => {
  const config = await readGlobalConfig();
  return c.json(config);
});

gitConfig.put("/api/git/config", async (c) => {
  const body = await c.req.json();
  const { key, value } = body;
  if (!key || !value) return c.json({ error: "Key and value required" }, 400);

  const result = await setGlobalConfig(key, value);
  if (!result.ok) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ ok: true });
});

export default gitConfig;
