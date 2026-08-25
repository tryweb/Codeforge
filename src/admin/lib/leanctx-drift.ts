import { createHash } from "node:crypto";
import { parse, type TomlTableWithoutBigInt } from "smol-toml";
import { execInAiDev, type ExecResult } from "./docker";
import {
  BASELINE_CONFIG_PATH,
  GLOBAL_CONFIG_PATH,
  PROJECT_CONFIG_PATH,
} from "./leanctx";

export { BASELINE_CONFIG_PATH, GLOBAL_CONFIG_PATH, PROJECT_CONFIG_PATH } from "./leanctx";

export const LEAN_CTX_SENTINEL_COMMAND = "printf 'lean-ctx-reliability-sentinel-v1\\n'";
export const EXPECTED_SENTINEL_OUTPUT = "lean-ctx-reliability-sentinel-v1\n";
export const EXPECTED_SENTINEL_BYTES = Buffer.byteLength(EXPECTED_SENTINEL_OUTPUT, "utf8");
export const EXPECTED_SENTINEL_SHA256 = createHash("sha256").update(EXPECTED_SENTINEL_OUTPUT).digest("hex");

const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 10_000;

export type ConfigReadResult = {
  readonly content: string | null;
  readonly error?: string;
};

export interface LeanCtxDriftDeps {
  readonly readConfig: (path: string) => Promise<ConfigReadResult>;
  readonly exec: (command: string, timeoutMs: number) => Promise<ExecResult>;
}

export interface LeanCtxDriftOptions {
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

export type LeanCtxDriftStatus =
  | { readonly status: "healthy"; readonly details: readonly string[] }
  | { readonly status: "config_drift"; readonly details: readonly string[] }
  | { readonly status: "project_override"; readonly details: readonly string[] }
  | { readonly status: "daemon_unavailable"; readonly details: readonly string[] }
  | {
      readonly status: "behavioral_mismatch";
      readonly details: readonly string[];
      readonly expectedBytes: number;
      readonly observedBytes: number;
      readonly expectedSha256: string;
      readonly observedSha256: string;
    }
  | { readonly status: "indeterminate"; readonly details: readonly string[] };

export type DoneClaim = LeanCtxDriftStatus & {
  readonly done: true;
  readonly checkedAt: string;
};

type LayerName = "baseline" | "global" | "project";

type ParsedLayer = {
  readonly name: LayerName;
  readonly path: string;
  readonly present: boolean;
  readonly compressionLevel: string | null;
  readonly error?: string;
};

type BoundedOutcome<T> =
  | { readonly kind: "completed"; readonly value: T }
  | { readonly kind: "timed_out" }
  | { readonly kind: "failed"; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function parseLayer(name: LayerName, path: string, read: ConfigReadResult): ParsedLayer {
  if (read.error) return { name, path, present: false, compressionLevel: null, error: read.error };
  if (read.content === null || read.content.trim() === "") {
    return { name, path, present: false, compressionLevel: null };
  }

  try {
    const table: TomlTableWithoutBigInt = parse(read.content, { integersAsBigInt: false });
    if (!Object.hasOwn(table, "compression_level")) {
      return { name, path, present: true, compressionLevel: null };
    }
    const value = table.compression_level;
    return typeof value === "string"
      ? { name, path, present: true, compressionLevel: value }
      : { name, path, present: true, compressionLevel: null, error: "compression_level must be a string" };
  } catch (error: unknown) {
    return { name, path, present: true, compressionLevel: null, error: errorMessage(error) };
  }
}

function boundedTimeout(timeoutMs: number | undefined): number {
  return Math.max(1, Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
}

function boundedOperation<T>(operation: () => Promise<T>, timeoutMs: number): Promise<BoundedOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timed_out" });
    }, timeoutMs);

    operation().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "completed", value });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "failed", message: errorMessage(error) });
      },
    );
  });
}

function outcomeFailure<T>(path: string, outcome: BoundedOutcome<T>, timeoutMs: number): string | null {
  switch (outcome.kind) {
    case "completed":
      return null;
    case "timed_out":
      return `config read timed out after ${timeoutMs}ms: ${path}`;
    case "failed":
      return `config read failed for ${path}: ${outcome.message}`;
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected bounded operation state: ${String(value)}`);
}

async function readLayers(
  deps: LeanCtxDriftDeps,
  timeoutMs: number,
): Promise<readonly ParsedLayer[] | string> {
  const [baseline, global, project] = await Promise.all([
    boundedOperation(() => deps.readConfig(BASELINE_CONFIG_PATH), timeoutMs),
    boundedOperation(() => deps.readConfig(GLOBAL_CONFIG_PATH), timeoutMs),
    boundedOperation(() => deps.readConfig(PROJECT_CONFIG_PATH), timeoutMs),
  ]);
  const failures = [
    outcomeFailure(BASELINE_CONFIG_PATH, baseline, timeoutMs),
    outcomeFailure(GLOBAL_CONFIG_PATH, global, timeoutMs),
    outcomeFailure(PROJECT_CONFIG_PATH, project, timeoutMs),
  ];
  const failure = failures.find((message): message is string => message !== null);
  if (failure) return failure;
  if (baseline.kind !== "completed" || global.kind !== "completed" || project.kind !== "completed") {
    return "config read did not produce a result";
  }
  return [
    parseLayer("baseline", BASELINE_CONFIG_PATH, baseline.value),
    parseLayer("global", GLOBAL_CONFIG_PATH, global.value),
    parseLayer("project", PROJECT_CONFIG_PATH, project.value),
  ];
}

function mismatchClaim(output: string): LeanCtxDriftStatus {
  const observedBytes = Buffer.byteLength(output, "utf8");
  const observedSha256 = createHash("sha256").update(output).digest("hex");
  const details = output.includes("[lean-ctx:")
    ? ["sentinel output contains a [lean-ctx: marker"]
    : ["sentinel output byte or hash differs from the fixed expectation"];
  return {
    status: "behavioral_mismatch",
    details,
    expectedBytes: EXPECTED_SENTINEL_BYTES,
    observedBytes,
    expectedSha256: EXPECTED_SENTINEL_SHA256,
    observedSha256,
  };
}

function claim(status: LeanCtxDriftStatus, now: () => string): DoneClaim {
  return { ...status, done: true, checkedAt: now() };
}

async function readConfigFromAiDev(path: string): Promise<ConfigReadResult> {
  const result = await execInAiDev(`cat ${path} 2>/dev/null || true`, DEFAULT_TIMEOUT_MS, { preserveOutput: true });
  return result.exitCode === 0
    ? { content: result.stdout || null }
    : { content: null, error: `config read failed with exit code ${result.exitCode}` };
}

const REAL_DEPS: LeanCtxDriftDeps = {
  readConfig: readConfigFromAiDev,
  exec: (command, timeoutMs) => execInAiDev(command, timeoutMs, { preserveOutput: true }),
};

export async function detectLeanCtxDrift(
  deps: LeanCtxDriftDeps = REAL_DEPS,
  options: LeanCtxDriftOptions = {},
): Promise<DoneClaim> {
  const now = options.now ?? (() => new Date().toISOString());
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const layers = await readLayers(deps, timeoutMs);
  if (typeof layers === "string") return claim({ status: "indeterminate", details: [layers] }, now);

  const malformed = layers.find((layer) => layer.error);
  if (malformed?.error) {
    return claim({ status: "indeterminate", details: [`${malformed.name} config is malformed: ${malformed.error}`] }, now);
  }

  const baseline = layers[0];
  const global = layers[1];
  const project = layers[2];
  if (!baseline.present || baseline.compressionLevel === null) {
    return claim({ status: "indeterminate", details: ["baseline lacks an explicit compression_level"] }, now);
  }
  if (baseline.compressionLevel !== "off" || global.compressionLevel !== null && global.compressionLevel !== "off") {
    return claim({ status: "config_drift", details: ["baseline or global compression_level is not off"] }, now);
  }
  if (project.present) {
    return claim({ status: "project_override", details: [`project override present at ${project.path}`] }, now);
  }

  const outcome = await boundedOperation(() => deps.exec(LEAN_CTX_SENTINEL_COMMAND, timeoutMs), timeoutMs);
  if (outcome.kind === "timed_out") {
    return claim({ status: "daemon_unavailable", details: [`sentinel timed out after ${timeoutMs}ms`] }, now);
  }
  if (outcome.kind === "failed") {
    return claim({ status: "daemon_unavailable", details: [`sentinel execution failed: ${outcome.message}`] }, now);
  }
  if (outcome.value.exitCode !== 0) {
    return claim({ status: "daemon_unavailable", details: [`sentinel exited with code ${outcome.value.exitCode}`] }, now);
  }
  return claim(
    outcome.value.stdout === EXPECTED_SENTINEL_OUTPUT
      ? { status: "healthy", details: [] }
      : mismatchClaim(outcome.value.stdout),
    now,
  );
}
