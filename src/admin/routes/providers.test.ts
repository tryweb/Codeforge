import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import providers from "./providers";

interface RegistryFixture {
  directory: string;
  registryPath: string;
  cleanup: () => Promise<void>;
}

async function fixture(seed: string): Promise<RegistryFixture> {
  const directory = await mkdtemp(join(tmpdir(), "provider-keys-routes-"));
  const registryPath = join(directory, "provider-keys.json");
  await writeFile(registryPath, seed);
  return {
    directory,
    registryPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function readRegistry(path: string): Promise<{ providers: Record<string, { keys: Array<Record<string, string>> }> }> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("provider API-key note endpoints", () => {
  test("POST adds a note without changing legacy keys", async () => {
    const f = await fixture(JSON.stringify({
      providers: {
        "opencode-go": {
          keys: [{ id: "legacy", value: "sk-legacy", createdAt: "2026-01-01T00:00:00.000Z" }],
          activeKeyId: "legacy",
        },
      },
    }));
    const previousPath = Bun.env.PROVIDER_KEYS_PATH;
    Bun.env.PROVIDER_KEYS_PATH = f.registryPath;
    try {
      const response = await providers.request("http://localhost/api/providers/opencode-go/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "sk-new", note: "billing account" }),
      });

      expect(response.status).toBe(200);
      const registry = await readRegistry(f.registryPath);
      expect(registry.providers["opencode-go"]?.keys[0]).toEqual({
        id: "legacy",
        value: "sk-legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(registry.providers["opencode-go"]?.keys[1]?.note).toBe("billing account");
    } finally {
      if (previousPath === undefined) delete Bun.env.PROVIDER_KEYS_PATH;
      else Bun.env.PROVIDER_KEYS_PATH = previousPath;
      await f.cleanup();
    }
  });

  test("PUT updates a legacy key note and persists it", async () => {
    const f = await fixture(JSON.stringify({
      providers: {
        "opencode-go": {
          keys: [{ id: "legacy", value: "sk-legacy", createdAt: "2026-01-01T00:00:00.000Z" }],
          activeKeyId: "legacy",
        },
      },
    }));
    const previousPath = Bun.env.PROVIDER_KEYS_PATH;
    Bun.env.PROVIDER_KEYS_PATH = f.registryPath;
    try {
      const response = await providers.request("http://localhost/api/providers/opencode-go/keys/legacy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "rotated in July" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      const registry = await readRegistry(f.registryPath);
      expect(registry.providers["opencode-go"]?.keys[0]).toEqual({
        id: "legacy",
        value: "sk-legacy",
        note: "rotated in July",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      if (previousPath === undefined) delete Bun.env.PROVIDER_KEYS_PATH;
      else Bun.env.PROVIDER_KEYS_PATH = previousPath;
      await f.cleanup();
    }
  });
});
