import { execInAiDev } from "./docker";
import { parse, stringify } from "smol-toml";

const GLOBAL_CONFIG_PATH = "/home/devuser/.config/lean-ctx/config.toml";
const PROJECT_CONFIG_PATH = "/home/devuser/workspace/ai-engkit/.lean-ctx.toml";

export interface LeanCtxConfig {
  [key: string]: unknown;
}

export interface LeanCtxConfigWithMeta extends LeanCtxConfig {
  _meta?: {
    source: "global" | "project" | "merged";
    globalPath: string;
    projectPath: string;
    hasProjectOverride: boolean;
  };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

export interface DoctorResult {
  ok: boolean;
  output: string;
  parsed?: {
    configEffective: boolean;
    warnings: string[];
    errors: string[];
  };
}

export interface ApplyResult {
  ok: boolean;
  output: string;
}

function parseTomlSafe(content: string): LeanCtxConfig {
  try {
    return parse(content) as LeanCtxConfig;
  } catch {
    return {};
  }
}

async function readRawConfigFile(path: string): Promise<string | null> {
  const result = await execInAiDev(`cat ${path} 2>/dev/null || true`, 10_000);
  return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

async function writeRawConfigFile(path: string, content: string): Promise<boolean> {
  const b64 = Buffer.from(content, "utf-8").toString("base64");
  const result = await execInAiDev(
    `mkdir -p "$(dirname ${path})" && echo '${b64}' | base64 -d > ${path} && chmod 600 ${path} && echo OK`,
    10_000,
  );
  return result.exitCode === 0;
}

async function readConfigFile(path: string): Promise<LeanCtxConfig> {
  const raw = await readRawConfigFile(path);
  return raw === null ? {} : parseTomlSafe(raw);
}

export async function readLeanCtxConfig(): Promise<LeanCtxConfigWithMeta> {
  const globalConfig = await readConfigFile(GLOBAL_CONFIG_PATH);
  const projectConfig = await readConfigFile(PROJECT_CONFIG_PATH);

  const hasProjectOverride = (await readRawConfigFile(PROJECT_CONFIG_PATH)) !== null;
  let merged: LeanCtxConfig = { ...globalConfig };
  let source: "global" | "project" | "merged" = "global";

  if (hasProjectOverride) {
    merged = deepMerge(globalConfig, projectConfig);
    source = Object.keys(projectConfig).length > 0 ? "merged" : "global";
  }

  return {
    ...merged,
    _meta: {
      source,
      globalPath: GLOBAL_CONFIG_PATH,
      projectPath: PROJECT_CONFIG_PATH,
      hasProjectOverride,
    },
  };
}

function deepMerge(target: LeanCtxConfig, source: LeanCtxConfig): LeanCtxConfig {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as LeanCtxConfig, value as LeanCtxConfig);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function writeLeanCtxConfig(
  config: LeanCtxConfig,
  target: "global" | "project" = "global",
): Promise<{ ok: boolean; error?: string }> {
  const path = target === "global" ? GLOBAL_CONFIG_PATH : PROJECT_CONFIG_PATH;

  // Merge into the existing raw text to preserve comments/sections; fall back
  // to a full serialization when the file is absent or the merge is unsafe.
  let toml = stringify(config);
  const raw = await readRawConfigFile(path);
  if (raw !== null) {
    const merged = mergeConfigIntoToml(raw, config);
    if (merged !== null) toml = merged;
  }

  const ok = await writeRawConfigFile(path, toml);
  return ok ? { ok: true } : { ok: false, error: "Failed to write lean-ctx config in ai-dev" };
}

/**
 * Merge `config` into raw TOML, rewriting only the lines/blocks whose key value
 * actually changed and preserving every other line byte-for-byte (comments,
 * blank lines, section headers, and unchanged multi-line arrays/tables).
 * Returns null when the document cannot be parsed.
 */
export function mergeConfigIntoToml(rawToml: string, config: LeanCtxConfig): string | null {
  const originalConfig = parseTomlSafe(rawToml);
  const lines = rawToml.split("\n");

  // Safety: if the raw TOML is non-empty but failed to parse (parseTomlSafe
  // returned {}), we cannot tell which keys already exist — every key would be
  // treated as new and appended, duplicating the original lines. Fall back to
  // full serialization instead.
  const hasAssignments = lines.some((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("#") && !t.startsWith("[") && findAssignment(t) !== -1;
  });
  if (Object.keys(originalConfig).length === 0 && hasAssignments) {
    return null;
  }

  const changedKeys = new Set<string>();
  for (const key of Object.keys(config)) {
    if (!deepEqual(originalConfig[key], config[key])) changedKeys.add(key);
  }
  for (const key of Object.keys(originalConfig)) {
    if (!(key in config)) changedKeys.add(key);
  }

  const serialized = new Map<string, string>();
  for (const [key, value] of Object.entries(config)) {
    serialized.set(key, tomlValue(key, value));
  }

  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) {
      result.push(line);
      i++;
      continue;
    }

    const eq = findAssignment(trimmed);
    if (eq === -1) {
      result.push(line);
      i++;
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || !changedKeys.has(key)) {
      result.push(line);
      i++;
      continue;
    }

    if (isMultiLineValue(trimmed.slice(eq + 1))) {
      let j = i;
      let depth = bracketDepth(trimmed);
      while (j < lines.length && depth > 0) {
        j++;
        if (j < lines.length) depth += bracketDepth(lines[j]);
      }
      result.push(serialized.get(key) ?? line);
      i = j + 1;
    } else {
      result.push(serialized.get(key) ?? line);
      i++;
    }
  }

  const appended: string[] = [];
  for (const [key, value] of serialized) {
    if (changedKeys.has(key) && !(key in originalConfig)) {
      // Dedup: the key may already appear in the result lines (e.g. dotted
      // keys like `archive.enabled` that parseTomlSafe surfaces as nested
      // objects, not flat keys). Appending it again would create duplicate
      // TOML keys.
      if (result.some((l) => l.trim().startsWith(`${key} =`))) continue;
      appended.push(value);
    }
  }
  if (appended.length > 0) {
    if (result.length > 0 && result[result.length - 1] !== "") result.push("");
    result.push(...appended);
  }

  return result.join("\n");
}

function isMultiLineValue(valueText: string): boolean {
  const t = valueText.trim();
  return t.startsWith("[") && bracketDepth(t) > 0;
}

function bracketDepth(line: string): number {
  let depth = 0;
  let inStr: string | null = null;
  for (const ch of line) {
    if (inStr) {
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
  }
  return depth;
}

function findAssignment(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "=") return i;
  }
  return -1;
}

function tomlValue(key: string, value: unknown): string {
  return `${key} = ${stringifyScalar(value)}`;
}

function stringifyScalar(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stringifyScalar(v)).join(", ") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return "{ " + entries.map(([k, v]) => `${k} = ${stringifyScalar(v)}`).join(", ") + " }";
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    return (a as unknown[]).every((v, idx) => deepEqual(v, (b as unknown[])[idx]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export async function validateLeanCtxConfig(config: LeanCtxConfig): Promise<ValidationResult> {
  const toml = stringify(config);
  const result = await execInAiDev(
    `cat <<'TOMLEOF' | lean-ctx config validate -\n${toml}\nTOMLEOF`,
    15_000,
  );

  if (result.exitCode === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    error: result.stderr || result.stdout || "Validation failed",
    warnings: result.stderr ? [result.stderr] : [],
  };
}

export async function runLeanCtxDoctor(): Promise<DoctorResult> {
  const result = await execInAiDev("lean-ctx doctor 2>&1", 30_000);

  const output = result.stdout || result.stderr || "";
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const line of output.split("\n")) {
    if (line.includes("WARN") || line.includes("warning") || line.includes("⚠")) {
      warnings.push(line.trim());
    } else if (line.includes("ERROR") || line.includes("error") || line.includes("✗")) {
      errors.push(line.trim());
    }
  }

  return {
    ok: result.exitCode === 0 && errors.length === 0,
    output,
    parsed: {
      configEffective: !output.includes("config.toml") || output.includes("effective"),
      warnings,
      errors,
    },
  };
}

export async function applyLeanCtxConfig(): Promise<ApplyResult> {
  const result = await execInAiDev("lean-ctx config apply 2>&1", 15_000);

  return {
    ok: result.exitCode === 0,
    output: result.stdout || result.stderr || "",
  };
}

export function getConfigValue(config: LeanCtxConfig, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = config;

  for (const key of keys) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

export function setConfigValue(config: LeanCtxConfig, path: string, value: unknown): LeanCtxConfig {
  const keys = path.split(".");
  const result = JSON.parse(JSON.stringify(config)) as LeanCtxConfig;
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return result;
}

export function deleteConfigValue(config: LeanCtxConfig, path: string): LeanCtxConfig {
  const keys = path.split(".");
  const result = JSON.parse(JSON.stringify(config)) as LeanCtxConfig;
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      return result;
    }
    current = current[key] as Record<string, unknown>;
  }

  delete current[keys[keys.length - 1]];
  return result;
}
