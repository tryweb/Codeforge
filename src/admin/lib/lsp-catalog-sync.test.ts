import { describe, expect, test } from "bun:test";
import { LSP_CATALOG } from "./lsp-catalog";

const INIT_CONFIG_URL = new URL("../../../entrypoint.d/02-init-config.sh", import.meta.url);

async function readShellMirror(): Promise<Record<string, { command: string[]; extensions: string[] }>> {
  const source = await Bun.file(INIT_CONFIG_URL).text();
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l.startsWith("LSP_CATALOG_JSON="));
  const end = lines.findIndex((l) => l === "JSON");
  return JSON.parse(lines.slice(start + 1, end).join("\n"));
}

describe("shell catalog mirror", () => {
  test("entrypoint mirror matches the TS catalog exactly", async () => {
    const mirror = await readShellMirror();
    expect(Object.keys(mirror).sort()).toEqual(LSP_CATALOG.map((e) => e.serverKey).sort());
    for (const entry of LSP_CATALOG) {
      expect(mirror[entry.serverKey].command).toEqual([...entry.command]);
      expect(mirror[entry.serverKey].extensions).toEqual([...entry.extensions]);
    }
  });
});
