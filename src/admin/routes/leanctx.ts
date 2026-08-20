import { Hono } from "hono";
import {
  readLeanCtxConfig,
  writeLeanCtxConfig,
  validateLeanCtxConfig,
  runLeanCtxDoctor,
  applyLeanCtxConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  type LeanCtxConfig,
} from "../lib/leanctx";
import { LEANCTX_SCHEMA, type LeanCtxSchemaEntry } from "../lib/leanctx-schema";
import { LeanCtxEditorPage } from "../views/leanctx-editor";

const leanctx = new Hono();

leanctx.get("/api/leanctx/config", async (c) => {
  const config = await readLeanCtxConfig();
  const { _meta, ...cleanConfig } = config;
  return c.json({ config: cleanConfig, meta: _meta });
});

leanctx.get("/api/leanctx/schema", (c) => {
  return c.json({ schema: LEANCTX_SCHEMA });
});

leanctx.put("/api/leanctx/config", async (c) => {
  try {
    const body = await c.req.json();
    const config = body.config as LeanCtxConfig;
    const target = (body.target as "global" | "project") || "global";

    if (!config || typeof config !== "object") {
      return c.json({ error: "Config must be an object" }, 400);
    }

    const result = await writeLeanCtxConfig(config, target);
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, 500);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid JSON" }, 400);
  }
});

leanctx.post("/api/leanctx/config/validate", async (c) => {
  try {
    const body = await c.req.json();
    const config = body.config as LeanCtxConfig;

    if (!config || typeof config !== "object") {
      return c.json({ error: "Config must be an object" }, 400);
    }

    const result = await validateLeanCtxConfig(config);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid JSON" }, 400);
  }
});

leanctx.get("/api/leanctx/doctor", async (c) => {
  const result = await runLeanCtxDoctor();
  return c.json(result);
});

leanctx.post("/api/leanctx/apply", async (c) => {
  const result = await applyLeanCtxConfig();
  return c.json(result);
});

leanctx.post("/api/leanctx/config/set", async (c) => {
  try {
    const body = await c.req.json();
    const { key, value, target } = body;

    if (!key || typeof key !== "string") {
      return c.json({ error: "Key is required" }, 400);
    }

    const currentConfig = await readLeanCtxConfig();
    const { _meta, ...cleanConfig } = currentConfig;
    const updatedConfig = setConfigValue(cleanConfig, key, value);
    const result = await writeLeanCtxConfig(updatedConfig, target || "global");
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, 500);

    return c.json({ ok: true, config: updatedConfig });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to set value" }, 400);
  }
});

leanctx.post("/api/leanctx/config/delete", async (c) => {
  try {
    const body = await c.req.json();
    const { key, target } = body;

    if (!key || typeof key !== "string") {
      return c.json({ error: "Key is required" }, 400);
    }

    const currentConfig = await readLeanCtxConfig();
    const { _meta, ...cleanConfig } = currentConfig;
    const updatedConfig = deleteConfigValue(cleanConfig, key);
    const result = await writeLeanCtxConfig(updatedConfig, target || "global");
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, 500);

    return c.json({ ok: true, config: updatedConfig });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to delete value" }, 400);
  }
});

leanctx.post("/api/leanctx/config/reset", async (c) => {
  try {
    const body = await c.req.json();
    const { target } = body;

    const schemaDefaults = LEANCTX_SCHEMA.reduce((acc, entry) => {
      if (entry.default !== undefined) {
        acc[entry.key] = entry.default;
      }
      return acc;
    }, {} as LeanCtxConfig);

    const result = await writeLeanCtxConfig(schemaDefaults, target || "global");
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, 500);
    return c.json({ ok: true, config: schemaDefaults });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to reset config" }, 400);
  }
});

leanctx.get("/leanctx", async (c) => {
  const config = await readLeanCtxConfig();
  const { _meta, ...cleanConfig } = config;
  return c.html(LeanCtxEditorPage(cleanConfig, _meta, LEANCTX_SCHEMA));
});

export default leanctx;