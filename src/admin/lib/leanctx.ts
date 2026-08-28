import { execInAiDev } from "./docker";
import { filterToSchema } from "./leanctx-schema";
import { restartAiDev } from "./restart-ai-dev";
import { parse, stringify } from "smol-toml";

export const BASELINE_CONFIG_PATH = "/etc/lean-ctx/config.default.toml";
export const GLOBAL_CONFIG_PATH = "/home/devuser/.config/lean-ctx/config.toml";
export const PROJECT_CONFIG_PATH = "/home/devuser/workspace/ai-engkit/.lean-ctx.toml";

export interface LeanCtxConfig {
  [key: string]: unknown;
}

export interface LeanCtxConfigWithMeta extends LeanCtxConfig {
  _meta?: {
    source: "global" | "project" | "merged";
    globalPath: string;
    projectPath: string;
    hasProjectOverride: boolean;
    baselinePath: string;
    runtimeParseError?: string;
    projectParseError?: string;
    baselineParseError?: string;
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
  readonly ok: boolean;
  readonly output: string;
  readonly status: "apply_failed" | "restart_failed" | "unverified" | "applied";
  readonly error?: string;
}

export interface LeanCtxApplyDeps {
  readonly exec: typeof execInAiDev;
  readonly restart: typeof restartAiDev;
  readonly sleep: (delayMs: number) => Promise<void>;
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
  const project = await readConfigFile(PROJECT_CONFIG_PATH);

  const hasProjectOverride = project.present;
  let merged: LeanCtxConfig = mergeLeanCtxConfig(baseline.config, global.config);
  let source: "global" | "project" | "merged" = "global";

  if (hasProjectOverride) {
    merged = mergeLeanCtxConfig(merged, project.config);
    source = Object.keys(project.config).length > 0 ? "merged" : "global";
  }

  return {
    ...merged,
    _meta: {
      source,
      globalPath: GLOBAL_CONFIG_PATH,
      projectPath: PROJECT_CONFIG_PATH,
      hasProjectOverride,
      baselinePath: BASELINE_CONFIG_PATH,
      runtimeParseError: global.parseError,
      projectParseError: project.parseError,
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

export async function writeLeanCtxConfig(
  config: LeanCtxConfig,
  target: "global" | "project" = "global",
  options: { allowOverwriteMalformed?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const path = target === "global" ? GLOBAL_CONFIG_PATH : PROJECT_CONFIG_PATH;
  const supportedConfig = filterToSchema(config);

  // Merge into the existing raw text to preserve comments/sections; fall back
  // to a full serialization when the file is absent or the merge is unsafe.
  let toml = stringify(supportedConfig);
  const raw = await readRawConfigFile(path);
  if (raw !== null) {
    const rawConfig = parseTomlSafe(raw);
    const mergedConfig = mergeLeanCtxConfig(rawConfig, supportedConfig);
    const hasUnsupportedKeys = !deepEqual(rawConfig, filterToSchema(rawConfig));
    const merged = hasUnsupportedKeys ? null : mergeConfigIntoToml(raw, supportedConfig);
    if (merged === null && !options.allowOverwriteMalformed && !hasUnsupportedKeys) {
      return { ok: false, error: `${path} is malformed; reset the configuration before saving` };
    }
    if (merged !== null) toml = merged;
    else if (hasUnsupportedKeys) toml = stringify(filterToSchema(mergedConfig));
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

export async function runLeanCtxDoctor(exec: typeof execInAiDev = execInAiDev): Promise<DoctorResult> {
  const result = await exec("lean-ctx doctor 2>&1", 30_000);

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

const REAL_APPLY_DEPS: LeanCtxApplyDeps = {
  exec: execInAiDev,
  restart: restartAiDev,
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

export async function applyLeanCtxConfig(deps: LeanCtxApplyDeps = REAL_APPLY_DEPS): Promise<ApplyResult> {
  const result = await deps.exec("lean-ctx config apply 2>&1", 15_000);
  const output = result.stdout || result.stderr || "";

  if (result.exitCode !== 0) {
    return {
      ok: false,
      status: "apply_failed",
      output,
      error: output || "LeanCTX config apply failed",
    };
  }

  const restart = await deps.restart();
  if (!restart.ok) {
    return {
      ok: false,
      status: "restart_failed",
      output,
      error: restart.error || "Failed to restart ai-dev container",
    };
  }

  return { ok: true, status: "applied", output };
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
