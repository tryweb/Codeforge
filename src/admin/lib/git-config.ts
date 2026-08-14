import { execInAiDev, type ExecResult } from "./docker";
import { maskKey } from "./provider-keys";

export type GitCommand = (command: string, timeoutMs: number) => Promise<ExecResult>;

/** Key-material patterns shared with the agent command masking (sk-, ghp_, glpat-, AIza, token=, secret). */
export const KEY_MATERIAL_PATTERN = /(sk-|ghp_|glpat-|AIza|token=|secret)/i;

const DROPPED_SECTIONS = ["credential.", "url."];

/** Read the global git config as-is (local admin route behavior). */
export async function readGlobalConfig(command: GitCommand = execInAiDev): Promise<Record<string, string>> {
  const result = await command("git config --global --list 2>/dev/null || true", 15_000);
  const config: Record<string, string> = {};
  for (const line of result.stdout.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    config[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
  }
  return config;
}

/** Read the global git config for remote consumption: drop credential helpers and URL rewrites, mask key-like values. */
export async function readSanitizedGlobalConfig(command: GitCommand = execInAiDev): Promise<Record<string, string>> {
  const raw = await readGlobalConfig(command);
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (DROPPED_SECTIONS.some((section) => key.startsWith(section))) continue;
    config[key] = KEY_MATERIAL_PATTERN.test(value) ? maskKey(value) : value;
  }
  return config;
}

export async function setGlobalConfig(
  key: string,
  value: string,
  command: GitCommand = execInAiDev,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await command(
    `git config --global ${JSON.stringify(key)} ${JSON.stringify(value)}`,
    15_000,
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || "Failed to set config" };
  }
  return { ok: true };
}
