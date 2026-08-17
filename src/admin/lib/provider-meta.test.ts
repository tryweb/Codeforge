import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectProvidersMeta } from "./provider-meta";
import { maskKey } from "./provider-keys";

interface RegistryFixture {
  registryPath: string;
  cleanup: () => Promise<void>;
}

/** Point PROVIDER_KEYS_PATH at a tmp registry (seeded or absent) for one test. */
async function withRegistry(seed: string | null, run: (f: RegistryFixture) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "provider-meta-"));
  const registryPath = join(directory, "provider-keys.json");
  if (seed !== null) await writeFile(registryPath, seed);
  const previousPath = Bun.env.PROVIDER_KEYS_PATH;
  Bun.env.PROVIDER_KEYS_PATH = registryPath;
  try {
    await run({ registryPath, cleanup: () => rm(directory, { recursive: true, force: true }) });
  } finally {
    if (previousPath === undefined) delete Bun.env.PROVIDER_KEYS_PATH;
    else Bun.env.PROVIDER_KEYS_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}

describe("collectProvidersMeta", () => {
  test("returns invalid:false with no configured providers when the registry file is missing", async () => {
    // CI has no /opt/ai-engkit/.env, so readEnvFile() yields {} and
    // OPENCODE_PROVIDER is empty. Key-managed providers still surface as
    // virtual cards, so the assertion pins: nothing configured, nothing from
    // a registry that does not exist.
    await withRegistry(null, async () => {
      const meta = await collectProvidersMeta();
      expect(meta.invalid).toBe(false);
      expect(meta.error).toBeNull();
      expect(meta.providers.filter((p) => !p.virtual)).toEqual([]);
      for (const provider of meta.providers) {
        expect(provider.registry.keyCount).toBe(0);
        expect(provider.registry.keys).toEqual([]);
      }
    });
  });

  test("masks a seeded registry key and never exposes the raw value", async () => {
    const rawKey = "sk-live-1234567890abcdef";
    const seed = JSON.stringify({
      providers: {
        "opencode-go": {
          keys: [{ id: "k1", value: rawKey, createdAt: "2026-01-01T00:00:00.000Z" }],
          activeKeyId: "k1",
        },
      },
    });
    await withRegistry(seed, async () => {
      const meta = await collectProvidersMeta();
      const provider = meta.providers.find((p) => p.name === "opencode-go");
      expect(provider).toBeDefined();
      expect(provider?.registry.keyCount).toBe(1);
      expect(provider?.registry.activeKeyId).toBe("k1");
      const key = provider?.registry.keys[0];
      expect(key?.masked).toBe(maskKey(rawKey));
      expect(key?.active).toBe(true);
      expect(JSON.stringify(meta)).not.toContain(rawKey);
    });
  });

  test("surfaces openai as a key-managed virtual card with OAuth metadata", async () => {
    const seed = JSON.stringify({
      providers: {
        openai: {
          keys: [{ id: "k1", value: "sk-openai-1", createdAt: "2026-01-01T00:00:00.000Z" }],
          activeKeyId: "k1",
        },
      },
    });
    await withRegistry(seed, async () => {
      const meta = await collectProvidersMeta();
      const openai = meta.providers.find((p) => p.name === "openai");
      expect(openai).toBeDefined();
      expect(openai?.label).toBe("OpenAI API");
      expect(openai?.virtual).toBe(true);
      expect(openai?.keyManagement).toBe(true);
      expect(openai?.oauthManaged).toBe(true);
      expect(typeof openai?.oauthConnected).toBe("boolean");
      expect(openai?.registry.keyCount).toBe(1);
      expect(openai?.registry.activeKeyId).toBe("k1");
    });
  });
});
