import { Hono } from "hono";
import { existsSync } from "node:fs";
import { readEnvFile, upsertEnvVar, envFileExists } from "../lib/env";
import { PROVIDER_ENV_KEY, parseProviders } from "../lib/providers";
import { execInAiDev, getAiDevContainerRef, dockerCommand, getComposeProject } from "../lib/docker";
import { EnvEditorPage } from "../views/env-editor";
import { ENV_SCHEMA } from "../lib/env-schema";

const env = new Hono();

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

  if (key === PROVIDER_ENV_KEY) {
    const parsed = parseProviders(value);
    if (!parsed.ok) {
      return c.json({ error: `OPENCODE_PROVIDER must be valid JSON: ${parsed.error}` }, 400);
    }
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

/** Restart ai-dev: compose recreate in prod (re-reads .env), plain restart in dev/DooD. */
export async function restartAiDev(): Promise<{ ok: boolean; error?: string }> {
  const ref = await getAiDevContainerRef();

  const composePath = "/opt/ai-engkit/compose.yml";
  const envFilePath = "/opt/ai-engkit/.env";
  if (existsSync(composePath)) {
    const project = await getComposeProject();
    const result = await dockerCommand(
      `compose -p ${project} --env-file ${envFilePath} -f ${composePath} up -d --force-recreate ai-dev 2>&1`,
      120_000,
    );
    if (result.exitCode === 0) return { ok: true };
    return { ok: false, error: result.stderr || "Compose recreate failed" };
  }

  const result = await dockerCommand(`restart ${ref}`, 30_000);
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || "Failed to restart ai-dev container" };
  }
  return { ok: true };
}

env.post("/api/env/restart", async (c) => {
  const result = await restartAiDev();
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json({ ok: true });
});

env.get("/env", async (c) => {
  const envVars = readEnvFile();
  return c.html(EnvEditorPage(envVars, ENV_SCHEMA));
});

export default env;
