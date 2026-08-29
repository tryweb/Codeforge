import { execInAiDev } from "./docker";
import { filterToSchema } from "./leanctx-schema";
import { parse, stringify } from "smol-toml";

export const BASELINE_CONFIG_PATH = "/etc/lean-ctx/config.default.toml";
export const GLOBAL_CONFIG_PATH = "/home/devuser/.config/lean-ctx/config.toml";

export interface LeanCtxConfig {
  [key: string]: unknown;
}

export interface LeanCtxConfigWithMeta extends LeanCtxConfig {
  _meta?: {
    globalPath: string;
    baselinePath: string;
    runtimeParseError?: string;
    baselineParseError?: string;
  };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

export interface ApplyResult {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
}

export interface LeanCtxApplyDeps {
  readonly exec: typeof execInAiDev;
}

export interface ConfigFileResult {
  config: LeanCtxConfig;
  present: boolean;
  parseError?: string;
}

export function parseLeanCtxToml(content: string, path: string): ConfigFileResult {
  try {
    return { config: parse(content) as LeanCtxConfig, present: true };
  } catch (error) {
    return {
      config: {},
      present: true,
      parseError: `${path} is malformed TOML: ${error instanceof Error ? error.message : "unknown parse error"}`,
    };
  }
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

async function readConfigFile(path: string): Promise<ConfigFileResult> {
  const raw = await readRawConfigFile(path);
  return raw === null ? { config: {}, present: false } : parseLeanCtxToml(raw, path);
}

export async function readLeanCtxBaseline(): Promise<ConfigFileResult> {
  return readConfigFile(BASELINE_CONFIG_PATH);
}

export async function readLeanCtxConfig(): Promise<LeanCtxConfigWithMeta> {
  const baseline = await readLeanCtxBaseline();
  const global = await readConfigFile(GLOBAL_CONFIG_PATH);

  return {
    ...mergeLeanCtxConfig(baseline.config, global.config),
    _meta: {
      globalPath: GLOBAL_CONFIG_PATH,
      baselinePath: BASELINE_CONFIG_PATH,
      runtimeParseError: global.parseError,
      baselineParseError: baseline.parseError,
    },
  };
}

export function mergeLeanCtxConfig(...configs: LeanCtxConfig[]): LeanCtxConfig {
  return configs.reduce((merged, config) => deepMerge(merged, config), {});
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

function isPlainObject(value: unknown): value is LeanCtxConfig {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneConfig(config: LeanCtxConfig): LeanCtxConfig {
  const clone: LeanCtxConfig = {};
  for (const [key, value] of Object.entries(config)) {
    clone[key] = isPlainObject(value) ? cloneConfig(value) : value;
  }
  return clone;
}

/**
 * Expand flat dotted schema keys ("archive.enabled") into nested objects
 * ({ archive: { enabled: ... } }) so smol-toml emits real TOML tables instead
 * of quoted literal keys ("archive.enabled" = true), which lean-ctx ignores.
 * Keys are processed in sorted order — a prefix always sorts before its
 * extensions — so on a collision the deeper (more specific) key wins.
 */
export function expandDottedKeys(config: LeanCtxConfig): LeanCtxConfig {
  const result = cloneConfig(config);
  for (const key of Object.keys(result).sort()) {
    if (!key.includes(".")) continue;
    const value = result[key];
    delete result[key];
    const segments = key.split(".");
    let cursor = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = cursor[segment];
      if (isPlainObject(existing)) {
        cursor = existing;
      } else {
        const nested: LeanCtxConfig = {};
        cursor[segment] = nested;
        cursor = nested;
      }
    }
    cursor[segments[segments.length - 1]] = value;
  }
  return result;
}

/**
 * Filter to schema-supported keys, expand flat dotted keys into nested
 * tables, and serialize to TOML.
 */
export function serializeLeanCtxConfig(config: LeanCtxConfig): string {
  return stringify(expandDottedKeys(filterToSchema(config)));
}

export async function writeLeanCtxConfig(
  config: LeanCtxConfig,
  options: { allowOverwriteMalformed?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const supportedConfig = filterToSchema(config);

  // Merge into the existing raw text to preserve comments/sections; fall back
  // to a full serialization when the file is absent or the merge is unsafe.
  let toml = serializeLeanCtxConfig(config);
  const raw = await readRawConfigFile(GLOBAL_CONFIG_PATH);
  if (raw !== null) {
    const rawConfig = parseTomlSafe(raw);
    const mergedConfig = mergeLeanCtxConfig(rawConfig, supportedConfig);
    const hasUnsupportedKeys = !deepEqual(rawConfig, filterToSchema(rawConfig));
    const merged = hasUnsupportedKeys ? null : mergeConfigIntoToml(raw, supportedConfig);
    if (merged === null && !options.allowOverwriteMalformed && !hasUnsupportedKeys) {
      return { ok: false, error: `${GLOBAL_CONFIG_PATH} is malformed; reset the configuration before saving` };
    }
    if (merged !== null) toml = merged;
    else if (hasUnsupportedKeys) toml = serializeLeanCtxConfig(mergedConfig);
  }

  const ok = await writeRawConfigFile(GLOBAL_CONFIG_PATH, toml);
  return ok ? { ok: true } : { ok: false, error: "Failed to write lean-ctx config in ai-dev" };
}

export interface LeanCtxResetDeps {
  readonly writeFile: typeof writeRawConfigFile;
}

const REAL_RESET_DEPS: LeanCtxResetDeps = { writeFile: writeRawConfigFile };

/**
 * Reset-specific write: serialize the baseline alone and replace the global
 * file wholesale. Unlike writeLeanCtxConfig this never merges into the
 * existing raw TOML, so stale keys from a prior global that the baseline does
 * not set (e.g. archive.enabled or autonomy.* overrides) are dropped.
 */
export async function resetLeanCtxConfig(
  baseline: LeanCtxConfig,
  deps: LeanCtxResetDeps = REAL_RESET_DEPS,
): Promise<{ ok: boolean; error?: string }> {
  const toml = serializeLeanCtxConfig(baseline);
  const ok = await deps.writeFile(GLOBAL_CONFIG_PATH, toml);
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
  const toml = serializeLeanCtxConfig(config);
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

const REAL_APPLY_DEPS: LeanCtxApplyDeps = {
  exec: execInAiDev,
};

export async function applyLeanCtxConfig(deps: LeanCtxApplyDeps = REAL_APPLY_DEPS): Promise<ApplyResult> {
  const result = await deps.exec("lean-ctx config apply 2>&1", 15_000);
  const output = result.stdout || result.stderr || "";

  if (result.exitCode !== 0) {
    return {
      ok: false,
      output,
      error: output || "LeanCTX config apply failed",
    };
  }

  return { ok: true, output };
}
