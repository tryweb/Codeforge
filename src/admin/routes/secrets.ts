import { Hono } from "hono";
import { readEnvFile } from "../lib/env";
import { getSecretActivationStatus, isSecretKey, SECRETS_SCHEMA, setSecretValue } from "../lib/secrets";
import { SecretsPage } from "../views/secrets";

const secrets = new Hono();

interface SecretMeta {
  key: string;
  description: string;
  hasValue: boolean;
  activationStatus: ActivationStatus;
  category: string;
  note?: string;
}

secrets.get("/api/secrets", (c) => {
  const envVars = readEnvFile();
  const result: SecretMeta[] = SECRETS_SCHEMA.map((s) => ({
    key: s.key,
    description: s.description,
    hasValue: !!envVars[s.key] && envVars[s.key].length > 0,
    activationStatus: s.activationStatus,
    category: s.category,
    ...(s.note ? { note: s.note } : {}),
  }));
  return c.json(result);
});

secrets.get("/api/secrets/:key/value", (c) => {
  const key = c.req.param("key");
  if (!isSecretKey(key)) return c.json({ error: "Secret not found" }, 404);

  const envVars = readEnvFile();
  const value = envVars[key] ?? "";
  return c.json({ key, value });
});

secrets.put("/api/secrets/:key", async (c) => {
  const key = c.req.param("key");
  if (!isSecretKey(key)) return c.json({ error: "Secret not found" }, 404);

  const body = await c.req.json();
  const value = body.value;

  if (typeof value !== "string" || value.length === 0) {
    return c.json({ error: "Value must be a non-empty string" }, 400);
  }

  const activationStatus = setSecretValue(key, value);
  return c.json({
    ok: true,
    activationStatus,
  });
});

secrets.get("/secrets", async (c) => {
  const envVars = readEnvFile();
  return c.html(SecretsPage(envVars));
});

export default secrets;
