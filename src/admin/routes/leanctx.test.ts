import { describe, expect, test } from "bun:test";
import type {
  ApplyResult,
  LeanCtxConfigWithMeta,
  ValidationResult,
} from "../lib/leanctx";
import { createLeanCtxRoutes, type LeanCtxRoutesDeps } from "./leanctx";

// Route tests inject lib fakes through LeanCtxRoutesDeps (repo DI pattern) so
// no docker command runs and no process-global module mock leaks into other
// test files.
function depsWith(overrides: Partial<LeanCtxRoutesDeps> = {}): {
  readonly deps: LeanCtxRoutesDeps;
  readonly lib: {
    config: Record<string, unknown>;
    meta: LeanCtxConfigWithMeta["_meta"];
    baseline: { config: Record<string, unknown>; present: boolean; parseError?: string };
    writeResult: { ok: boolean; error?: string };
    writeCalls: Array<Record<string, unknown>>;
    resetResult: { ok: boolean; error?: string };
    resetCalls: Array<Record<string, unknown>>;
    validateResult: ValidationResult;
    validateInput: Record<string, unknown> | null;
    applyResult: ApplyResult;
    applyCalls: number;
  };
} {
  const lib = {
    config: { compression_level: "max" } as Record<string, unknown>,
    meta: {
      globalPath: "/home/devuser/.config/lean-ctx/config.toml",
      baselinePath: "/etc/lean-ctx/config.default.toml",
    } as LeanCtxConfigWithMeta["_meta"],
    baseline: {
      config: { compression_level: "lite" } as Record<string, unknown>,
      present: true,
      parseError: undefined as string | undefined,
    },
    writeResult: { ok: true } as { ok: boolean; error?: string },
    writeCalls: [] as Array<Record<string, unknown>>,
    resetResult: { ok: true } as { ok: boolean; error?: string },
    resetCalls: [] as Array<Record<string, unknown>>,
    validateResult: { ok: true } as ValidationResult,
    validateInput: null as Record<string, unknown> | null,
    applyResult: { ok: true, output: "applied" } as ApplyResult,
    applyCalls: 0,
  };

  const deps: LeanCtxRoutesDeps = {
    readConfig: async () => ({ ...lib.config, _meta: lib.meta }) as LeanCtxConfigWithMeta,
    readBaseline: async () => lib.baseline,
    writeConfig: async (config) => {
      lib.writeCalls.push(config);
      return lib.writeResult;
    },
    resetConfig: async (baseline) => {
      lib.resetCalls.push(baseline);
      return lib.resetResult;
    },
    validateConfig: async (config) => {
      lib.validateInput = config;
      return lib.validateResult;
    },
    applyConfig: async () => {
      lib.applyCalls += 1;
      return lib.applyResult;
    },
    ...overrides,
  };

  return { deps, lib };
}

describe("removed leanctx routes", () => {
  test("GET /api/leanctx/drift is gone", async () => {
    const { deps } = depsWith();
    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/drift");
    expect(response.status).toBe(404);
  });

  test("GET /api/leanctx/status is gone", async () => {
    const { deps } = depsWith();
    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/status");
    expect(response.status).toBe(404);
  });

  test("GET /api/leanctx/doctor is gone", async () => {
    const { deps } = depsWith();
    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/doctor");
    expect(response.status).toBe(404);
  });

  test("POST /api/leanctx/config/set is gone", async () => {
    const { deps } = depsWith();
    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config/set", {
      method: "POST",
      body: JSON.stringify({ key: "compression_level", value: "max" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(404);
  });

  test("POST /api/leanctx/config/delete is gone", async () => {
    const { deps } = depsWith();
    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config/delete", {
      method: "POST",
      body: JSON.stringify({ key: "compression_level" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(404);
  });
});

describe("GET /api/leanctx/config", () => {
  test("returns the global config, baseline, and meta", async () => {
    const { deps, lib } = depsWith();

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      config: { compression_level: "max" },
      baseline: { compression_level: "lite" },
      meta: lib.meta,
    });
  });
});

describe("GET /api/leanctx/schema", () => {
  test("returns schema entries with baseline-derived defaults", async () => {
    const { deps } = depsWith();

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/schema");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { schema: Array<{ key: string; default: unknown }> };
    const compression = body.schema.find((entry) => entry.key === "compression_level");
    expect(compression?.default).toBe("lite");
  });
});

describe("PUT /api/leanctx/config", () => {
  test("writes the submitted config to the global layer", async () => {
    const { deps, lib } = depsWith();
    lib.writeResult = { ok: true };

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config", {
      method: "PUT",
      body: JSON.stringify({ config: { compression_level: "max" } }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(lib.writeCalls).toEqual([{ compression_level: "max" }]);
  });

  test("rejects a malformed global config with 409", async () => {
    const { deps, lib } = depsWith();
    lib.writeResult = { ok: false, error: "/home/devuser/.config/lean-ctx/config.toml is malformed; reset the configuration before saving" };

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config", {
      method: "PUT",
      body: JSON.stringify({ config: { compression_level: "max" } }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: lib.writeResult.error });
  });

  test("rejects a non-object config with 400", async () => {
    const { deps } = depsWith();

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config", {
      method: "PUT",
      body: JSON.stringify({ config: "nope" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/leanctx/config/validate", () => {
  test("validates the submitted config", async () => {
    const { deps, lib } = depsWith();
    lib.validateResult = { ok: true };

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config/validate", {
      method: "POST",
      body: JSON.stringify({ config: { compression_level: "max" } }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(lib.validateInput).toEqual({ compression_level: "max" });
  });
});

describe("POST /api/leanctx/apply", () => {
  test("delegates to the apply dependency", async () => {
    const { deps, lib } = depsWith();
    lib.applyResult = { ok: true, output: "applied" };

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/apply", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, output: "applied" });
    expect(lib.applyCalls).toBe(1);
  });
});

describe("POST /api/leanctx/config/reset", () => {
  test("replaces the global config with the baseline via the reset dependency", async () => {
    const { deps, lib } = depsWith();
    lib.resetResult = { ok: true };
    lib.baseline.parseError = undefined;

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config/reset", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, config: { compression_level: "lite" } });
    expect(lib.resetCalls).toEqual([{ compression_level: "lite" }]);
    expect(lib.writeCalls).toEqual([]);
  });

  test("reports a reset write failure with 500", async () => {
    const { deps, lib } = depsWith();
    lib.resetResult = { ok: false, error: "Failed to write lean-ctx config in ai-dev" };

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config/reset", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to write lean-ctx config in ai-dev" });
  });

  test("reports a malformed baseline with 500", async () => {
    const { deps, lib } = depsWith();
    lib.baseline.parseError = "/etc/lean-ctx/config.default.toml is malformed TOML: broken";

    const response = await createLeanCtxRoutes(deps).request("http://localhost/api/leanctx/config/reset", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: lib.baseline.parseError });
  });
});

describe("GET /leanctx", () => {
  test("renders the structured editor without drift or doctor UI", async () => {
    const { deps } = depsWith();

    const response = await createLeanCtxRoutes(deps).request("http://localhost/leanctx");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("LeanCTX Configuration");
    expect(html).toContain('data-key="compression_level"');
    expect(html).not.toContain("leanctx-drift-warning");
    expect(html).not.toContain("/api/leanctx/drift");
    expect(html).not.toContain("/api/leanctx/status");
    expect(html).not.toContain("Run LeanCTX Doctor");
  });
});
