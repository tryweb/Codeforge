import { Hono } from "hono";
import {
  applyLeanCtxConfig,
  readLeanCtxBaseline,
  readLeanCtxConfig,
  resetLeanCtxConfig,
  validateLeanCtxConfig,
  writeLeanCtxConfig,
  type LeanCtxConfig,
} from "../lib/leanctx";
import { resolveSchemaDefaults } from "../lib/leanctx-schema";
import { LeanCtxEditorPage } from "../views/leanctx-editor";

export interface LeanCtxRoutesDeps {
  readonly readConfig: typeof readLeanCtxConfig;
  readonly readBaseline: typeof readLeanCtxBaseline;
  readonly writeConfig: typeof writeLeanCtxConfig;
  readonly resetConfig: typeof resetLeanCtxConfig;
  readonly validateConfig: typeof validateLeanCtxConfig;
  readonly applyConfig: typeof applyLeanCtxConfig;
}

const REAL_DEPS: LeanCtxRoutesDeps = {
  readConfig: readLeanCtxConfig,
  readBaseline: readLeanCtxBaseline,
  writeConfig: writeLeanCtxConfig,
  resetConfig: resetLeanCtxConfig,
  validateConfig: validateLeanCtxConfig,
  applyConfig: applyLeanCtxConfig,
};

export function createLeanCtxRoutes(options: Partial<LeanCtxRoutesDeps> = {}): Hono {
  const deps: LeanCtxRoutesDeps = { ...REAL_DEPS, ...options };
  const leanctx = new Hono();

  function writeErrorStatus(error: string | undefined): 409 | 500 {
    return error?.includes("malformed") ? 409 : 500;
  }

  leanctx.get("/api/leanctx/config", async (c) => {
    const config = await deps.readConfig();
    const baseline = await deps.readBaseline();
    const { _meta, ...cleanConfig } = config;
    return c.json({ config: cleanConfig, baseline: baseline.config, meta: _meta });
  });

  leanctx.get("/api/leanctx/schema", async (c) => {
    const baseline = await deps.readBaseline();
    return c.json({ schema: resolveSchemaDefaults(baseline.config) });
  });

  leanctx.put("/api/leanctx/config", async (c) => {
    try {
      const body = await c.req.json();
      const config = body.config as LeanCtxConfig;

      if (!config || typeof config !== "object") {
        return c.json({ error: "Config must be an object" }, 400);
      }

      const result = await deps.writeConfig(config);
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

      return c.json(await deps.validateConfig(config));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Invalid JSON" }, 400);
    }
  });

  leanctx.post("/api/leanctx/apply", async (c) => c.json(await deps.applyConfig()));

  leanctx.post("/api/leanctx/config/reset", async (c) => {
    try {
      const baseline = await deps.readBaseline();
      if (baseline.parseError) return c.json({ error: baseline.parseError }, 500);

      const result = await deps.resetConfig(baseline.config);
      if (!result.ok) return c.json({ error: result.error || "Failed to reset config" }, 500);
      return c.json({ ok: true, config: baseline.config });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to reset config" }, 400);
    }
  });

  leanctx.get("/leanctx", async (c) => {
    const [config, baseline] = await Promise.all([
      deps.readConfig(),
      deps.readBaseline(),
    ]);
    const { _meta, ...cleanConfig } = config;
    return c.html(LeanCtxEditorPage(cleanConfig, _meta, resolveSchemaDefaults(baseline.config)));
  });

  return leanctx;
}

export default createLeanCtxRoutes();
