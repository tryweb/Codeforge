import { readEnvFile } from "./env";
import { PROVIDER_ENV_KEY, parseProviders, getProviderApiKey } from "./providers";
import { readProviderKeys, maskKey } from "./provider-keys";
import {
  KEY_MANAGED_PROVIDERS,
  isKeyProviderSupported,
  readProviderAuthKey,
  readProviderOAuthPresence,
} from "./opencode-auth";

export interface ProviderMeta {
  name: string;
  label: string;
  npm: string;
  baseURL: string;
  hasApiKey: boolean;
  keyManagement: boolean;
  authStoreKeyPresent: boolean;
  oauthManaged: boolean;
  oauthConnected: boolean;
  virtual: boolean;
  registry: {
    keyCount: number;
    activeKeyId: string | null;
    keys: Array<{ id: string; masked: string; note: string; active: boolean }>;
  };
}

const KEY_MANAGED_LABELS: Record<string, string> = {
  "opencode-go": "Opencode Go",
  openai: "OpenAI API",
};

/** Providers that also offer the ChatGPT Pro/Plus headless OAuth connection. */
export const OAUTH_MANAGED_PROVIDERS = ["openai"] as const;

export async function collectProvidersMeta(): Promise<{
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

  const keyManagedNames = Array.from(
    new Set([
      ...KEY_MANAGED_PROVIDERS,
      ...Object.keys(keys.providers),
      ...Object.keys(parsed.providers),
    ]),
  ).filter(isKeyProviderSupported);
  const authStoreKeys = new Map<string, string | null>();
  const authStoreOAuth = new Map<string, boolean>();
  await Promise.all(
    keyManagedNames.map(async (name) => {
      authStoreKeys.set(name, await readProviderAuthKey(name));
      authStoreOAuth.set(name, await readProviderOAuthPresence(name));
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
            note: k.note ?? "",
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
      oauthManaged: (OAUTH_MANAGED_PROVIDERS as readonly string[]).includes(name),
      oauthConnected: isKeyProviderSupported(name) ? !!authStoreOAuth.get(name) : false,
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
            note: k.note ?? "",
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
      oauthManaged: (OAUTH_MANAGED_PROVIDERS as readonly string[]).includes(name),
      oauthConnected: !!authStoreOAuth.get(name),
      virtual: true,
      registry,
    });
  }

  return { invalid: false, error: null, providers: out };
}
