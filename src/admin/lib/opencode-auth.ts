/**
 * Active-key application for key-managed providers (initially opencode-go).
 * The key is written into the ai-dev container's opencode auth store
 * ($HOME/.local/share/opencode/auth.json) via docker exec, then the
 * oh-my-opencode provider cache is cleared so the plugin re-probes.
 * Container restart is handled by the caller (restartAiDev).
 */
import { execInAiDev, type ExecResult } from "./docker";

// $HOME expands inside the container shell; a bare "~" would not survive
// parameter expansion and double quotes (POSIX tilde rules).
const AUTH_JSON_PATH = "$HOME/.local/share/opencode/auth.json";
const CACHE_FILES = [
  "$HOME/.cache/oh-my-opencode/connected-providers.json",
  "$HOME/.cache/oh-my-opencode/provider-models.json",
  "$HOME/.cache/oh-my-opencode/model-capabilities.json",
];

/** Providers whose credentials are managed via the opencode auth store. */
export const KEY_MANAGED_PROVIDERS = ["opencode-go"] as const;

export interface AuthSnapshotDeps {
  readonly execInAiDev: (command: string, timeoutMs: number) => Promise<ExecResult>;
}

class AuthStoreReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthStoreReadError";
  }
}

const REAL_AUTH_DEPS: AuthSnapshotDeps = { execInAiDev };

export function isKeyProviderSupported(provider: string): boolean {
  return (KEY_MANAGED_PROVIDERS as readonly string[]).includes(provider);
}

async function loadAuthStore(deps: AuthSnapshotDeps): Promise<Record<string, unknown>> {
  const result = await deps.execInAiDev(`cat ${AUTH_JSON_PATH} 2>/dev/null || echo '{}'`, 10_000);
  if (result.exitCode !== 0) throw new AuthStoreReadError("Failed to read opencode auth store");
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) throw new AuthStoreReadError("Invalid opencode auth store JSON");
    throw error;
  }
  throw new AuthStoreReadError("Invalid opencode auth store JSON");
}

/** Read the auth store JSON from the ai-dev container (or null on failure). */
export async function readAuthStore(): Promise<Record<string, unknown> | null> {
  try {
    return await loadAuthStore(REAL_AUTH_DEPS);
  } catch (error: unknown) {
    if (error instanceof AuthStoreReadError) return null;
    throw error;
  }
}

/** Read the existing key for a provider from the ai-dev auth store. */
export async function readProviderAuthKey(provider: string): Promise<string | null> {
  const store = await readAuthStore();
  if (!store) return null;
  const entry = store[provider] as { key?: unknown } | undefined;
  return typeof entry?.key === "string" && entry.key.length > 0 ? entry.key : null;
}

export async function readProviderAuthSnapshot(
  provider: string,
  deps: AuthSnapshotDeps = REAL_AUTH_DEPS,
): Promise<string | null> {
  const store = await loadAuthStore(deps);
  const entry = store[provider] as { key?: unknown } | undefined;
  return typeof entry?.key === "string" && entry.key.length > 0 ? entry.key : null;
}

/**
 * Write the active key into the ai-dev auth store. Read-modify-write via jq
 * inside the container preserves sibling provider entries; the tmp+mv dance
 * keeps the write atomic.
 */
export async function applyAuthKey(provider: string, key: string): Promise<void> {
  // jq needs bracket access: ".opencode-go" parses as subtraction (go/0)
  const filter = `.["${provider}"].type = "api" | .["${provider}"].key = $k`;
  const script = [
    `AUTH="${AUTH_JSON_PATH}"`,
    `mkdir -p "$(dirname "$AUTH")"`,
    `test -f "$AUTH" || echo '{}' > "$AUTH"`,
    `jq --arg k "${key}" '${filter}' "$AUTH" > "$AUTH.tmp" && mv "$AUTH.tmp" "$AUTH"`,
    `chmod 600 "$AUTH"`,
  ].join(" && ");
  const result = await execInAiDev(script, 15_000);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to write opencode auth store");
  }
}

/** Clear the oh-my-opencode provider cache so the plugin re-probes credentials. */
export async function clearProviderCache(): Promise<void> {
  const result = await execInAiDev(`rm -f ${CACHE_FILES.join(" ")}`, 10_000);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to clear provider cache");
  }
}

/** Apply an active key end-to-end (auth store write + cache clear). */
export async function applyActiveKey(provider: string, key: string): Promise<void> {
  await applyAuthKey(provider, key);
  await clearProviderCache();
}

/**
 * Remove a provider's entry from the ai-dev auth store (last key deleted).
 * jq del() is a no-op when the entry is absent; a missing file is left alone.
 */
export async function removeAuthKey(provider: string): Promise<void> {
  const filter = `del(.["${provider}"])`;
  const script = [
    `AUTH="${AUTH_JSON_PATH}"`,
    `test -f "$AUTH" || exit 0`,
    `jq '${filter}' "$AUTH" > "$AUTH.tmp" && mv "$AUTH.tmp" "$AUTH"`,
    `chmod 600 "$AUTH"`,
  ].join(" && ");
  const result = await execInAiDev(script, 15_000);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to remove key from opencode auth store");
  }
}
