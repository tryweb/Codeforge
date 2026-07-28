import { Hono } from "hono";
import { readEnvFile, upsertEnvVar } from "../lib/env";
import { SecretsPage } from "../views/secrets";

const secrets = new Hono();

const SECRETS_SCHEMA = [
  {
    key: "ADMIN_PASSWORD",
    description: "Admin dashboard login password",
    activationStatus: "immediate" as const,
    category: "admin",
  },
  {
    key: "OPENCHAMBER_UI_PASSWORD",
    description: "OpenChamber Web UI login password",
    activationStatus: "restart_required" as const,
    category: "service",
  },
  {
    key: "OPENCODE_SERVER_PASSWORD",
    description: "OpenCode API authentication",
    activationStatus: "restart_required" as const,
    category: "service",
    note: "OpenCode port is not exposed externally in standard deployment. This password provides defense-in-depth for internal API access and is essential when connecting to a remote OpenCode server via OPENCODE_HOST.",
  },
];

type ActivationStatus = "immediate" | "restart_required";

interface SecretMeta {
  key: string;
  description: string;
  hasValue: boolean;
  activationStatus: ActivationStatus;
  category: string;
  note?: string;
}

function getActivationStatus(key: string): ActivationStatus {
  const entry = SECRETS_SCHEMA.find((s) => s.key === key);
  return entry?.activationStatus ?? "restart_required";
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
  const schemaEntry = SECRETS_SCHEMA.find((s) => s.key === key);
  if (!schemaEntry) return c.json({ error: "Secret not found" }, 404);

  const envVars = readEnvFile();
  const value = envVars[key] ?? "";
  return c.json({ key, value });
});

secrets.put("/api/secrets/:key", async (c) => {
  const key = c.req.param("key");
  const schemaEntry = SECRETS_SCHEMA.find((s) => s.key === key);
  if (!schemaEntry) return c.json({ error: "Secret not found" }, 404);

  const body = await c.req.json();
  const value = body.value;

  if (typeof value !== "string" || value.length === 0) {
    return c.json({ error: "Value must be a non-empty string" }, 400);
  }

  upsertEnvVar(key, value);
  return c.json({
    ok: true,
    activationStatus: getActivationStatus(key),
  });
});

secrets.get("/secrets", async (c) => {
  const envVars = readEnvFile();
  return c.html(SecretsPage(envVars));
});

export default secrets;
