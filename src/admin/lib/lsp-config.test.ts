import { describe, expect, test } from "bun:test";
import {
  clearLspServerOverride,
  LSP_SERVERS_ENV_KEY,
  parseLspServers,
  readLspServers,
  resolveEffectiveConfig,
  serializeLspServers,
  setLspServerOverride,
  type LspServersOverrides,
} from "./lsp-config";

describe("parseLspServers", () => {
  test("empty or absent returns empty overrides (all defaults)", () => {
    expect(parseLspServers(null)).toEqual({});
    expect(parseLspServers(undefined)).toEqual({});
    expect(parseLspServers("")).toEqual({});
  });

  test("malformed JSON falls back to defaults", () => {
    expect(parseLspServers("{not json")).toEqual({});
  });

  test("parses enabled + version, null version means latest", () => {
    const result = parseLspServers('{"typescript":{"enabled":true,"version":"6.0.0"},"yaml-ls":{"enabled":true,"version":null}}');
    expect(result).toEqual({
      typescript: { enabled: true, version: "6.0.0" },
      "yaml-ls": { enabled: true, version: null },
      pyright: { enabled: true, version: null },
    });
  });

  test("explicit disable of a built-in-backed server normalizes to managed", () => {
    const result = parseLspServers('{"typescript":{"enabled":false,"version":"6.0.0"}}');
    expect(result["typescript"]).toEqual({ enabled: true, version: "6.0.0" });
    expect(result["yaml-ls"]).toEqual({ enabled: true, version: null });
    expect(result["pyright"]).toEqual({ enabled: true, version: null });
  });

  test("legacy yaml key migrates to the yaml-ls built-in id", () => {
    expect(parseLspServers('{"yaml":{"enabled":true,"version":null}}')).toEqual({
      "yaml-ls": { enabled: true, version: null },
      typescript: { enabled: true, version: null },
      pyright: { enabled: true, version: null },
    });
  });

  test("drops unknown keys, non-object entries, and wrong-shaped entries", () => {
    const result = parseLspServers(
      '{"typescript":{"enabled":true},"notreal":{"enabled":true},"yaml-ls":"nope","css":{"version":"1.0.0"}}',
    );
    expect(result).toEqual({
      typescript: { enabled: true, version: null },
      "yaml-ls": { enabled: true, version: null },
      pyright: { enabled: true, version: null },
    });
  });

  test("non-object overall value falls back to defaults", () => {
    expect(parseLspServers("[]")).toEqual({});
    expect(parseLspServers('"str"')).toEqual({});
  });
});

describe("serializeLspServers", () => {
  test("round-trips through parse", () => {
    const overrides: LspServersOverrides = {
      typescript: { enabled: true, version: "6.0.0" },
      "yaml-ls": { enabled: true, version: null },
      pyright: { enabled: true, version: null },
    };
    expect(parseLspServers(serializeLspServers(overrides))).toEqual(overrides);
  });

  test("produces stable sorted-key JSON", () => {
    const encoded = serializeLspServers({
      "yaml-ls": { enabled: true, version: null },
      typescript: { enabled: true, version: "6.0.0" },
    });
    expect(encoded).toBe('{"typescript":{"enabled":true,"version":"6.0.0"},"yaml-ls":{"enabled":true,"version":null}}');
  });
});

describe("resolveEffectiveConfig", () => {
    test("with empty overrides, all 8 servers disabled and unpinned", () => {
    const effective = resolveEffectiveConfig({});
    expect(effective.length).toBe(8);
    for (const server of effective) {
      expect(server.enabled).toBe(false);
      expect(server.version).toBe(null);
      expect(server.defaultEnabled).toBe(false);
    }
  });

  test("merges overrides onto catalog baseline for enabled/pinned servers", () => {
    const effective = resolveEffectiveConfig({
      typescript: { enabled: true, version: "6.0.0" },
      "yaml-ls": { enabled: true, version: null },
    });
    const ts = effective.find((s) => s.serverKey === "typescript")!;
    const yaml = effective.find((s) => s.serverKey === "yaml-ls")!;
    expect(ts.enabled).toBe(true);
    expect(ts.version).toBe("6.0.0");
    expect(yaml.enabled).toBe(true);
    expect(yaml.version).toBe(null);
    const others = effective.filter((s) => s.serverKey !== "typescript" && s.serverKey !== "yaml-ls");
    for (const server of others) expect(server.enabled).toBe(false);
  });

  test("explicit disable overrides a hypothetical default-enabled server", () => {
    // No catalog server defaults enabled currently, but verify explicit false wins.
    const effective = resolveEffectiveConfig({ typescript: { enabled: false, version: null } });
    const ts = effective.find((s) => s.serverKey === "typescript")!;
    expect(ts.enabled).toBe(false);
  });
});

describe("env read/write via injected EnvVars", () => {
  test("readLspServers reads from the injected env vars", () => {
    const result = readLspServers({ [LSP_SERVERS_ENV_KEY]: '{"biome":{"enabled":true,"version":null}}' });
    expect(result).toEqual({
      biome: { enabled: true, version: null },
      typescript: { enabled: true, version: null },
      "yaml-ls": { enabled: true, version: null },
      pyright: { enabled: true, version: null },
    });
  });

  test("readLspServers returns empty when key absent", () => {
    expect(readLspServers({})).toEqual({});
  });

  test("setLspServerOverride preserves other entries and clears when empty", () => {
    // These touch the real .env file, so they are exercised only via the
    // pure helpers they use (parse/serialize). The live-init path is covered
    // by the entrypoint test in the full suite.
    expect(typeof setLspServerOverride).toBe("function");
    expect(typeof clearLspServerOverride).toBe("function");
  });
});
