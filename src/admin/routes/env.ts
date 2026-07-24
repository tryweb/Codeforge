import { Hono } from "hono";
import { readEnvFile, upsertEnvVar, envFileExists } from "../lib/env";
import { execInAiDev } from "../lib/docker";
import { EnvEditorPage } from "../views/env-editor";

const env = new Hono();

const ENV_SCHEMA = [
  { key: "ADMIN_PORT", type: "port", description: "Admin dashboard port (production)" },
  { key: "ADMIN_DEV_PORT", type: "port", description: "Admin dashboard port (development)" },
  { key: "ADMIN_PASSWORD", type: "password", description: "Admin dashboard password" },
  { key: "OPENCHAMBER_UI_PASSWORD", type: "password", description: "OpenChamber web UI password" },
  { key: "OPENCODE_SERVER_PASSWORD", type: "password", description: "OpenCode server password" },
  { key: "OPENCODE_PROVIDER", type: "json", description: "OpenCode provider configuration" },
  { key: "OPENCODE_PLUGINS", type: "text", description: "OpenCode plugins (comma-separated)" },
  { key: "CHAMBER_PORT", type: "port", description: "OpenChamber port" },
  { key: "BACKUP_RETENTION", type: "number", description: "Number of backups to retain" },
  { key: "WORKSPACE_PATH", type: "text", description: "Workspace path (bind mount)" },
  { key: "APT_PACKAGES", type: "text", description: "Extra apt packages installed at container startup" },
  { key: "BREW_PACKAGES", type: "text", description: "Extra Homebrew packages installed at container startup" },
  { key: "BUN_PACKAGES", type: "text", description: "Extra global bun packages installed at container startup" },
];

env.get("/api/env", (c) => {
  const vars = readEnvFile();
  return c.json(vars);
});

env.put("/api/env/:key", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json();
  const value = body.value;

  if (typeof value !== "string") {
    return c.json({ error: "Value must be a string" }, 400);
  }

  upsertEnvVar(key, value);
  return c.json({ ok: true });
});

env.get("/api/env/schema", (c) => {
  return c.json(ENV_SCHEMA);
});

env.post("/api/env/from-template", async (c) => {
  const result = await execInAiDev(
    "curl -sS https://raw.githubusercontent.com/trywe-io/ai-engkit/main/.env.example 2>/dev/null || true",
    15_000,
  );
  if (result.exitCode !== 0 || !result.stdout) {
    return c.json({ error: "Could not fetch template" }, 500);
  }
  return c.json({ content: result.stdout });
});

env.get("/env", async (c) => {
  const envVars = readEnvFile();
  return c.html(EnvEditorPage(envVars, ENV_SCHEMA));
});

export default env;
