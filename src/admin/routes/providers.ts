import { Hono } from "hono";
import { readEnvFile, upsertEnvVar, deleteEnvVar } from "../lib/env";
import {
  PROVIDER_ENV_KEY,
  parseProviders,
  isValidProviderEntry,
  getProviderApiKey,
  serializeProviders,
  type ProvidersMap,
} from "../lib/providers";
import {
  readProviderKeys,
  addProviderKey,
  deleteProviderKey,
  setActiveProviderKey,
  deleteProviderKeys,
  maskKey,
} from "../lib/provider-keys";
import {
  KEY_MANAGED_PROVIDERS,
  isKeyProviderSupported,
  readProviderAuthKey,
  applyActiveKey,
  removeAuthKey,
  clearProviderCache,
} from "../lib/opencode-auth";
import { restartAiDev } from "./env";
import { ProvidersPage } from "../views/providers";

const providers = new Hono();

interface ProviderMeta {
  name: string;
  label: string;
  npm: string;
  baseURL: string;
  hasApiKey: boolean;
  keyManagement: boolean;
  authStoreKeyPresent: boolean;
  virtual: boolean;
  registry: {
    keyCount: number;
    activeKeyId: string | null;
    keys: Array<{ id: string; masked: string; active: boolean }>;
  };
}

const KEY_MANAGED_LABELS: Record<string, string> = {
  "opencode-go": "Opencode Go",
};

async function collectProvidersMeta(): Promise<{
  invalid: boolean;
  error: string | null;
  providers: ProviderMeta[];
}> {
  const envVars = readEnvFile();
  const parsed = parseProviders(envVars[PROVIDER_ENV_KEY] ?? "");
  const keys = readProviderKeys();
  if (!parsed.ok) {
    return { invalid: true, error: parsed.error, providers: [] };
  }

  const keyManagedNames = Object.keys(keys.providers).filter(isKeyProviderSupported);
  const authStoreKeys = new Map<string, string | null>();
  await Promise.all(
    keyManagedNames.map(async (name) => {
      authStoreKeys.set(name, await readProviderAuthKey(name));
    }),
  );

  const out = Object.entries(parsed.providers).map(([name, entry]): ProviderMeta => {
    const keyEntry = keys.providers[name];
    const registry = keyEntry
      ? {
          keyCount: keyEntry.keys.length,
          activeKeyId: keyEntry.activeKeyId,
          keys: keyEntry.keys.map((k) => ({
            id: k.id,
            masked: maskKey(k.value),
            active: k.id === keyEntry.activeKeyId,
          })),
        }
      : { keyCount: 0, activeKeyId: null, keys: [] };
    const baseURL =
      typeof entry.options?.baseURL === "string" ? entry.options.baseURL : "";
    return {
      name,
      label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : name,
      npm: typeof entry.npm === "string" ? entry.npm : "",
      baseURL,
      hasApiKey: getProviderApiKey(entry) !== null,
      keyManagement: isKeyProviderSupported(name),
      authStoreKeyPresent: isKeyProviderSupported(name) ? !!authStoreKeys.get(name) : false,
      virtual: false,
      registry,
    };
  });

  // Virtual cards for key-managed providers absent from OPENCODE_PROVIDER
  // (their credentials live in the opencode auth store, not the env var).
  for (const name of (KEY_MANAGED_PROVIDERS as readonly string[]) as string[]) {
    if (out.some((p) => p.name === name)) continue;
    const keyEntry = keys.providers[name];
    const registry = keyEntry
      ? {
          keyCount: keyEntry.keys.length,
          activeKeyId: keyEntry.activeKeyId,
          keys: keyEntry.keys.map((k) => ({
            id: k.id,
            masked: maskKey(k.value),
            active: k.id === keyEntry.activeKeyId,
          })),
        }
      : { keyCount: 0, activeKeyId: null, keys: [] };
    out.push({
      name,
      label: KEY_MANAGED_LABELS[name] ?? name,
      npm: "",
      baseURL: "",
      hasApiKey: false,
      keyManagement: true,
      authStoreKeyPresent: !!authStoreKeys.get(name),
      virtual: true,
      registry,
    });
  }

  return { invalid: false, error: null, providers: out };
}

function providerEntryFromBody(body: unknown): ProvidersMap[string] | null {
  const entry = (body as { provider?: unknown })?.provider;
  return isValidProviderEntry(entry) ? (entry as ProvidersMap[string]) : null;
}

providers.get("/api/providers", async (c) => {
  return c.json(await collectProvidersMeta());
});

providers.put("/api/providers/:name", async (c) => {
  const name = c.req.param("name").trim();
  if (!name) return c.json({ error: "Provider name required" }, 400);

  const entry = providerEntryFromBody(await c.req.json());
  if (!entry) {
    return c.json(
      { error: "Provider must be an object with valid npm/options/models fields" },
      400,
    );
  }

  const envVars = readEnvFile();
  const parsed = parseProviders(envVars[PROVIDER_ENV_KEY] ?? "");
  if (!parsed.ok) {
    return c.json({ error: `OPENCODE_PROVIDER is not valid JSON: ${parsed.error}` }, 400);
  }

  // Merge so apiKey (never sent by the client) and other existing fields survive.
  const existing = parsed.providers[name];
  const merged: ProvidersMap[string] = {
    ...existing,
    ...entry,
    options: { ...(existing?.options ?? {}), ...(entry.options ?? {}) },
  };
  if (entry.options && "apiKey" in entry.options) {
    if (entry.options.apiKey === "") {
      delete merged.options?.apiKey;
    } else {
      merged.options!.apiKey = entry.options.apiKey;
    }
  }
  parsed.providers[name] = merged;
  upsertEnvVar(PROVIDER_ENV_KEY, serializeProviders(parsed.providers));
  return c.json({ ok: true, activationStatus: "restart_required" });
});

providers.delete("/api/providers/:name", (c) => {
  const name = c.req.param("name");
  const envVars = readEnvFile();
  const parsed = parseProviders(envVars[PROVIDER_ENV_KEY] ?? "");
  if (!parsed.ok) {
    return c.json({ error: `OPENCODE_PROVIDER is not valid JSON: ${parsed.error}` }, 400);
  }
  if (!(name in parsed.providers)) return c.json({ error: "Provider not found" }, 404);

  delete parsed.providers[name];
  if (Object.keys(parsed.providers).length === 0) {
    deleteEnvVar(PROVIDER_ENV_KEY);
  } else {
    upsertEnvVar(PROVIDER_ENV_KEY, serializeProviders(parsed.providers));
  }
  deleteProviderKeys(name);
  return c.json({ ok: true });
});

providers.post("/api/providers/:name/keys", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json();
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!value) return c.json({ error: "Key must be a non-empty string" }, 400);

  const file = readProviderKeys();
  const wasFirstKey = !(file.providers[name]?.keys.length);

  if (wasFirstKey && isKeyProviderSupported(name)) {
    const existingAuthKey = await readProviderAuthKey(name);
    if (existingAuthKey) {
      return c.json(
        {
          error: `auth store already holds a key for ${name} (${maskKey(existingAuthKey)}). Use "Import from auth store" to adopt it, or delete the auth-store key first to replace it.`,
        },
        409,
      );
    }
  }

  const key = addProviderKey(name, value);

  if (wasFirstKey && isKeyProviderSupported(name)) {
    try {
      await applyActiveKey(name, key.value);
      const restart = await restartAiDev();
      if (!restart.ok) throw new Error(restart.error ?? "Restart failed");
    } catch (err) {
      deleteProviderKey(name, key.id);
      const message = err instanceof Error ? err.message : "Failed to apply key";
      return c.json({ error: `Apply failed; key not saved: ${message}` }, 500);
    }
  }

  return c.json({ ok: true, key: { id: key.id, masked: maskKey(key.value) } });
});

providers.get("/api/providers/:name/keys/:keyId/value", (c) => {
  const { name, keyId } = c.req.param();
  const file = readProviderKeys();
  const key = file.providers[name]?.keys.find((k) => k.id === keyId);
  if (!key) return c.json({ error: "Key not found" }, 404);
  return c.json({ ok: true, key: key.value });
});

providers.delete("/api/providers/:name/keys/:keyId", async (c) => {
  const { name, keyId } = c.req.param();
  const file = readProviderKeys();
  const wasActive = file.providers[name]?.activeKeyId === keyId;
  if (!deleteProviderKey(name, keyId)) return c.json({ error: "Key not found" }, 404);

  if (wasActive && isKeyProviderSupported(name)) {
    try {
      const remaining = readProviderKeys().providers[name];
      if (remaining?.activeKeyId) {
        const promoted = remaining.keys.find((k) => k.id === remaining.activeKeyId);
        if (promoted) await applyActiveKey(name, promoted.value);
      } else {
        await removeAuthKey(name);
        await clearProviderCache();
      }
      const restart = await restartAiDev();
      if (!restart.ok) throw new Error(restart.error ?? "Restart failed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sync auth store";
      return c.json({ error: `Key deleted but auth store sync failed: ${message}` }, 500);
    }
  }

  return c.json({ ok: true });
});

providers.put("/api/providers/:name/keys/:keyId/active", async (c) => {
  const { name, keyId } = c.req.param();
  const file = readProviderKeys();
  const entry = file.providers[name];
  const key = entry?.keys.find((k) => k.id === keyId);
  if (!key) return c.json({ error: "Key not found" }, 404);
  if (entry.activeKeyId === keyId) {
    return c.json({ ok: true, alreadyActive: true, activationStatus: "restart_required" });
  }

  const previousActive = entry.activeKeyId;
  if (!setActiveProviderKey(name, keyId)) {
    return c.json({ error: "Failed to set active key" }, 500);
  }

  if (isKeyProviderSupported(name)) {
    try {
      await applyActiveKey(name, key.value);
      const restart = await restartAiDev();
      if (!restart.ok) throw new Error(restart.error ?? "Restart failed");
    } catch (err) {
      if (previousActive) setActiveProviderKey(name, previousActive);
      const message = err instanceof Error ? err.message : "Failed to apply key";
      return c.json({ error: `Apply failed; selection reverted: ${message}` }, 500);
    }
  }

  return c.json({ ok: true, activationStatus: "restart_required" });
});

providers.get("/api/providers/:name/keys/import-candidate", async (c) => {
  const name = c.req.param("name");
  const file = readProviderKeys();
  if (file.providers[name]?.keys.length) {
    return c.json({ candidate: false, reason: "registry_not_empty" });
  }
  if (!isKeyProviderSupported(name)) {
    return c.json({ candidate: false, reason: "unsupported_provider" });
  }
  const existing = await readProviderAuthKey(name);
  if (!existing) return c.json({ candidate: false, reason: "no_auth_store_key" });
  return c.json({ candidate: true, masked: maskKey(existing) });
});

providers.post("/api/providers/:name/keys/import", async (c) => {
  const name = c.req.param("name");
  const file = readProviderKeys();
  if (file.providers[name]?.keys.length) {
    return c.json({ error: "Registry already has keys for this provider" }, 409);
  }
  if (!isKeyProviderSupported(name)) {
    return c.json({ error: "Key management not supported for this provider" }, 400);
  }
  const existing = await readProviderAuthKey(name);
  if (!existing) return c.json({ error: "No existing key in auth store" }, 404);

  const key = addProviderKey(name, existing);
  return c.json({ ok: true, key: { id: key.id, masked: maskKey(key.value) } });
});

providers.get("/providers", async (c) => {
  const meta = await collectProvidersMeta();
  const envVars = readEnvFile();
  const parsed = parseProviders(envVars[PROVIDER_ENV_KEY] ?? "");
  const entries: Record<string, unknown> = {};
  if (parsed.ok) {
    for (const [name, entry] of Object.entries(parsed.providers)) {
      const clean: Record<string, unknown> = { ...entry };
      if (clean.options && typeof clean.options === "object") {
        clean.options = { ...(clean.options as Record<string, unknown>) };
        delete (clean.options as Record<string, unknown>).apiKey;
      }
      entries[name] = clean;
    }
  }
  return c.html(ProvidersPage({ meta, entries }));
});

export default providers;
