import { Hono } from "hono";
import {
  applyLeanCtxConfig,
  deleteConfigValue,
  readLeanCtxBaseline,
  readLeanCtxConfig,
  runLeanCtxDoctor,
  setConfigValue,
  validateLeanCtxConfig,
  writeLeanCtxConfig,
  type LeanCtxConfig,
} from "../lib/leanctx";
import { resolveSchemaDefaults } from "../lib/leanctx-schema";
import { LeanCtxEditorPage } from "../views/leanctx-editor";
import { detectLeanCtxDrift, type DoneClaim } from "../lib/leanctx-drift";

export interface LeanCtxRoutesOptions {
  readonly detectDrift?: () => Promise<DoneClaim>;
}

export function createLeanCtxRoutes(options: LeanCtxRoutesOptions = {}): Hono {
  const leanctx = new Hono();
  const detectDrift = options.detectDrift ?? detectLeanCtxDrift;

  const detectDriftForPage = async (): Promise<DoneClaim> => {
    try {
      return await detectDrift();
    } catch {
      return {
        done: true,
        status: "indeterminate",
        details: ["drift detector failed before a status could be confirmed"],
        checkedAt: new Date().toISOString(),
      };
    }
  };

  leanctx.get("/api/leanctx/drift", async (c) => {
    try {
      return c.json(await detectDrift());
    } catch {
      return c.json({ error: "LeanCTX drift detection unavailable" }, 500);
    }
  });

  function writeErrorStatus(error: string | undefined): 409 | 500 {
    return error?.includes("malformed") ? 409 : 500;
  }

leanctx.get("/api/leanctx/config", async (c) => {
  const config = await readLeanCtxConfig();
  const baseline = await readLeanCtxBaseline();
  const { _meta, ...cleanConfig } = config;
  return c.json({ config: cleanConfig, baseline: baseline.config, meta: _meta });
});

leanctx.get("/api/leanctx/schema", async (c) => {
  const baseline = await readLeanCtxBaseline();
  return c.json({ schema: resolveSchemaDefaults(baseline.config) });
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
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, writeErrorStatus(result.error));
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

    return c.json(await validateLeanCtxConfig(config));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid JSON" }, 400);
  }
});

leanctx.get("/api/leanctx/doctor", async (c) => c.json(await runLeanCtxDoctor()));

leanctx.post("/api/leanctx/apply", async (c) => c.json(await applyLeanCtxConfig()));

leanctx.post("/api/leanctx/config/set", async (c) => {
  try {
    const body = await c.req.json();
    const { key, value, target } = body;

    if (!key || typeof key !== "string") return c.json({ error: "Key is required" }, 400);

    const currentConfig = await readLeanCtxConfig();
    const { _meta, ...cleanConfig } = currentConfig;
    const updatedConfig = setConfigValue(cleanConfig, key, value);
    const result = await writeLeanCtxConfig(updatedConfig, target || "global");
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, writeErrorStatus(result.error));

    return c.json({ ok: true, config: updatedConfig });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to set value" }, 400);
  }
});

leanctx.post("/api/leanctx/config/delete", async (c) => {
  try {
    const body = await c.req.json();
    const { key, target } = body;

    if (!key || typeof key !== "string") return c.json({ error: "Key is required" }, 400);

    const currentConfig = await readLeanCtxConfig();
    const { _meta, ...cleanConfig } = currentConfig;
    const updatedConfig = deleteConfigValue(cleanConfig, key);
    const result = await writeLeanCtxConfig(updatedConfig, target || "global");
    if (!result.ok) return c.json({ error: result.error || "Failed to write config" }, writeErrorStatus(result.error));

    return c.json({ ok: true, config: updatedConfig });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to delete value" }, 400);
  }
});

leanctx.post("/api/leanctx/config/reset", async (c) => {
  try {
    const body = await c.req.json();
    const target = (body.target as "global" | "project") || "global";
    const baseline = await readLeanCtxBaseline();
    if (baseline.parseError) return c.json({ error: baseline.parseError }, 500);

    const result = await writeLeanCtxConfig(baseline.config, target, { allowOverwriteMalformed: true });
    if (!result.ok) return c.json({ error: result.error || "Failed to reset config" }, 500);
    return c.json({ ok: true, config: baseline.config });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to reset config" }, 400);
  }
});

leanctx.get("/leanctx", async (c) => {
  const [config, baseline, drift] = await Promise.all([
    readLeanCtxConfig(),
    readLeanCtxBaseline(),
    detectDriftForPage(),
  ]);
  const { _meta, ...cleanConfig } = config;
  return c.html(LeanCtxEditorPage(cleanConfig, _meta, resolveSchemaDefaults(baseline.config), drift));
});

  return leanctx;
}

export default createLeanCtxRoutes();
