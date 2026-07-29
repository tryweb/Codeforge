import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { GitConfigPage } from "../views/git-config";

const gitConfig = new Hono();

gitConfig.get("/api/git/config", async (c) => {
  const result = await execInAiDev("git config --global --list 2>/dev/null || true", 15_000);
  const config: Record<string, string> = {};
  for (const line of result.stdout.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    config[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
  }
  return c.json(config);
});

gitConfig.put("/api/git/config", async (c) => {
  const body = await c.req.json();
  const { key, value } = body;
  if (!key || !value) return c.json({ error: "Key and value required" }, 400);

  const result = await execInAiDev(
    `git config --global ${JSON.stringify(key)} ${JSON.stringify(value)}`,
    15_000,
  );
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || "Failed to set config" }, 500);
  }
  return c.json({ ok: true });
});

gitConfig.get("/git-config", async (c) => {
  const configResult = await execInAiDev("git config --global --list 2>/dev/null || true", 15_000);

  const config: Record<string, string> = {};
  for (const line of configResult.stdout.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    config[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
  }

  return c.html(GitConfigPage(config));
});

export default gitConfig;
