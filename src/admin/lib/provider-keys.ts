/**
 * Provider API key registry — per-provider key lists plus the active selection.
 * Stored in /opt/ai-engkit/provider-state/provider-keys.json (directory-mounted
 * in production, the admin-data-dev named volume in dev), deliberately NOT in .env: keys must
 * not leak via `docker inspect` and env changes cannot apply in dev/DooD mode.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const KEYS_PATH = "/opt/ai-engkit/provider-state/provider-keys.json";

function providerKeysPath(): string {
  return Bun.env.PROVIDER_KEYS_PATH || KEYS_PATH;
}

export interface ProviderKey {
  id: string;
  value: string;
  note?: string;
  createdAt: string;
}

export interface ProviderKeyEntry {
  keys: ProviderKey[];
  activeKeyId: string | null;
}

export interface ProviderKeysFile {
  providers: Record<string, ProviderKeyEntry>;
}

const EMPTY: ProviderKeysFile = { providers: {} };

export function readProviderKeys(): ProviderKeysFile {
  const path = providerKeysPath();
  if (!existsSync(path)) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      const file = parsed as ProviderKeysFile;
      if (file.providers && typeof file.providers === "object") return file;
    }
  } catch {
    // Corrupt registry file: treat as empty rather than crashing the admin.
  }
  return EMPTY;
}

export function writeProviderKeys(file: ProviderKeysFile): void {
  const path = providerKeysPath();
  // Docker auto-creates a missing bind source as a directory; writing to it
  // would throw EISDIR. Fail with a clear message instead.
  if (existsSync(path) && !statSync(path).isFile()) {
    throw new Error(`provider-keys.json is not a regular file: ${path}`);
  }
  const tmp = join(dirname(path), `.provider-keys.json.tmp`);
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Mask a key for display: first 4 + last 4 chars. */
export function maskKey(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function addProviderKey(provider: string, value: string, note = ""): ProviderKey {
  const file = readProviderKeys();
  const entry: ProviderKeyEntry = file.providers[provider] ?? { keys: [], activeKeyId: null };
  const key: ProviderKey = {
    id: `k-${Date.now().toString(36)}`,
    value,
    note,
    createdAt: new Date().toISOString(),
  };
  entry.keys.push(key);
  if (entry.activeKeyId === null) entry.activeKeyId = key.id;
  file.providers[provider] = entry;
  writeProviderKeys(file);
  return key;
}

export function updateProviderKeyNote(provider: string, keyId: string, note: string): boolean {
  const file = readProviderKeys();
  const entry = file.providers[provider];
  if (!entry) return false;
  const key = entry.keys.find((candidate) => candidate.id === keyId);
  if (!key) return false;
  key.note = note;
  writeProviderKeys(file);
  return true;
}

/** Delete a key; the next key in the list is promoted when the active one goes. */
export function deleteProviderKey(provider: string, keyId: string): boolean {
  const file = readProviderKeys();
  const entry = file.providers[provider];
  if (!entry) return false;
  const idx = entry.keys.findIndex((k) => k.id === keyId);
  if (idx === -1) return false;
  entry.keys.splice(idx, 1);
  if (entry.activeKeyId === keyId) {
    entry.activeKeyId = entry.keys[Math.min(idx, entry.keys.length - 1)]?.id ?? null;
  }
  if (entry.keys.length === 0) {
    delete file.providers[provider];
  } else {
    file.providers[provider] = entry;
  }
  writeProviderKeys(file);
  return true;
}

export function setActiveProviderKey(provider: string, keyId: string): boolean {
  const file = readProviderKeys();
  const entry = file.providers[provider];
  if (!entry || !entry.keys.some((k) => k.id === keyId)) return false;
  entry.activeKeyId = keyId;
  file.providers[provider] = entry;
  writeProviderKeys(file);
  return true;
}

/** Drop the registry entry for a provider (used when the provider is deleted). */
export function deleteProviderKeys(provider: string): void {
  const file = readProviderKeys();
  if (!(provider in file.providers)) return;
  delete file.providers[provider];
  writeProviderKeys(file);
}
