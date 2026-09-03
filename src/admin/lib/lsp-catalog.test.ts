import { describe, expect, test } from "bun:test";
import {
  LSP_CATALOG,
  LSP_CATALOG_BY_KEY,
  packageServerKeys,
} from "./lsp-catalog";

describe("LSP_CATALOG", () => {
  test("contains exactly the 8 supported servers with unique keys", () => {
    const keys = LSP_CATALOG.map((e) => e.serverKey);
    expect(keys).toEqual([
      "typescript",
      "json",
      "css",
      "html",
      "yaml-ls",
      "dockerfile",
      "biome",
      "pyright",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("npm/exe name map", () => {
    const byKey = (k: string) => LSP_CATALOG_BY_KEY.get(k)!;

    expect(byKey("dockerfile").npmPackage).toBe("dockerfile-language-server-nodejs");
    expect(byKey("dockerfile").command[0]).toBe("docker-langserver");
    expect(byKey("json").npmPackage).toBe("vscode-langservers-extracted");
    expect(byKey("css").npmPackage).toBe("vscode-langservers-extracted");
    expect(byKey("html").npmPackage).toBe("vscode-langservers-extracted");
    expect(byKey("typescript").npmPackage).toBe("typescript-language-server");
    expect(byKey("yaml-ls").npmPackage).toBe("yaml-language-server");
    expect(byKey("biome").npmPackage).toBe("@biomejs/biome");
    expect(byKey("pyright").npmPackage).toBe("pyright");
    expect(byKey("pyright").command[0]).toBe("pyright-langserver");
  });

  test("built-in-backed servers are marked for always-managed", () => {
    const byKey = (k: string) => LSP_CATALOG_BY_KEY.get(k)!;
    expect(byKey("typescript").builtinBacked).toBe(true);
    expect(byKey("yaml-ls").builtinBacked).toBe(true);
    expect(byKey("pyright").builtinBacked).toBe(true);
    expect(byKey("json").builtinBacked).toBe(false);
    expect(byKey("dockerfile").builtinBacked).toBe(false);
  });

  test("shared package maps to its servers via packageServerKeys", () => {
    const shared = packageServerKeys("vscode-langservers-extracted");
    expect(shared.map((e) => e.serverKey)).toEqual(["json", "css", "html"]);
    expect(packageServerKeys("@biomejs/biome").map((e) => e.serverKey)).toEqual(["biome"]);
    expect(packageServerKeys("nonexistent-package")).toEqual([]);
  });

  test("every entry has a non-empty command and extensions and defaults disabled", () => {
    for (const entry of LSP_CATALOG) {
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.extensions.length).toBeGreaterThan(0);
      expect(entry.defaultEnabled).toBe(false);
    }
  });

  test("catalog-by-key resolves every key to an entry", () => {
    for (const entry of LSP_CATALOG) {
      expect(LSP_CATALOG_BY_KEY.get(entry.serverKey)).toBe(entry);
    }
    expect(LSP_CATALOG_BY_KEY.has("not-a-server")).toBe(false);
  });
});
