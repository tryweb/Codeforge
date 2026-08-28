import { createHash } from "node:crypto";
import { BoundaryParseError, hasOnlyKeys, isRecord } from "./boundary";

export const DRIFT_STATUSES = ["healthy", "config_drift", "project_override", "daemon_unavailable", "behavioral_mismatch", "indeterminate"] as const;
export type DriftStatus = (typeof DRIFT_STATUSES)[number];
export const EXPECTED_SENTINEL_BYTES = 33;
export const EXPECTED_SENTINEL_SHA256 = "266b4f79b67bef0b8d79d1683b016f4b4c42dc40aca415c7086316f754203b64";

export type CapturedLayer = {
  readonly present: boolean;
  readonly compressionLevel?: string | null;
  readonly raw?: string;
  readonly readError?: string;
  readonly malformed?: boolean;
};

export type CapturedSentinel = {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly execError?: string;
  readonly markerDetected?: boolean;
  readonly appendedContentDetected?: boolean;
  readonly expectedBytes: number;
  readonly expectedSha256: string;
  readonly observedBytes?: number;
  readonly observedSha256?: string;
};

export type CapturedDriftInput = {
  readonly baseline: CapturedLayer;
  readonly global: CapturedLayer;
  readonly project: CapturedLayer;
  readonly sentinel: CapturedSentinel;
};

export type DriftAssessment = {
  readonly status: DriftStatus;
  readonly details: readonly string[];
  readonly expectedBytes?: number;
  readonly observedBytes?: number;
  readonly expectedSha256?: string;
  readonly observedSha256?: string;
};

export type GateResult = {
  readonly passed: boolean;
  readonly status: DriftStatus;
  readonly details: readonly string[];
  readonly statuses?: readonly DriftStatus[];
};

export type ReliabilityGates = {
  readonly g0: GateResult;
  readonly g1: GateResult;
};

export function isCapturedDriftInput(value: unknown): value is CapturedDriftInput {
  try {
    parseCapturedDriftInput(value);
    return true;
  } catch (error: unknown) {
    if (error instanceof BoundaryParseError) return false;
    throw error;
  }
}

export function parseCapturedDriftInput(value: unknown, path = "captured"): CapturedDriftInput {
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected captured input object");
  hasOnlyKeys(value, ["baseline", "global", "project", "sentinel"], path);
  return {
    baseline: parseLayer(value["baseline"], `${path}.baseline`),
    global: parseLayer(value["global"], `${path}.global`),
    project: parseLayer(value["project"], `${path}.project`),
    sentinel: parseSentinel(value["sentinel"], `${path}.sentinel`),
  };
}

function parseLayer(value: unknown, path: string): CapturedLayer {
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected layer object");
  hasOnlyKeys(value, ["present", "compressionLevel", "raw", "readError", "malformed"], path);
  if (typeof value["present"] !== "boolean") throw new BoundaryParseError(path, "present must be boolean");
  if (value["compressionLevel"] !== undefined && value["compressionLevel"] !== null && typeof value["compressionLevel"] !== "string") throw new BoundaryParseError(path, "compressionLevel must be string or null");
  if (value["raw"] !== undefined && typeof value["raw"] !== "string") throw new BoundaryParseError(path, "raw must be string");
  if (value["readError"] !== undefined && typeof value["readError"] !== "string") throw new BoundaryParseError(path, "readError must be string");
  if (value["malformed"] !== undefined && typeof value["malformed"] !== "boolean") throw new BoundaryParseError(path, "malformed must be boolean");
  return {
    present: value["present"],
    ...(value["compressionLevel"] !== undefined ? { compressionLevel: value["compressionLevel"] } : {}),
    ...(value["raw"] !== undefined ? { raw: value["raw"] } : {}),
    ...(value["readError"] !== undefined ? { readError: value["readError"] } : {}),
    ...(value["malformed"] !== undefined ? { malformed: value["malformed"] } : {}),
  };
}

function parseSentinel(value: unknown, path: string): CapturedSentinel {
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected sentinel object");
  hasOnlyKeys(value, ["stdout", "stderr", "exitCode", "timedOut", "execError", "markerDetected", "appendedContentDetected", "expectedBytes", "expectedSha256", "observedBytes", "observedSha256"], path);
  const exitCode = nonNegativeInteger(value["exitCode"], `${path}.exitCode`);
  const timedOut = requiredBoolean(value["timedOut"], `${path}.timedOut`);
  const expectedBytes = nonNegativeInteger(value["expectedBytes"], `${path}.expectedBytes`);
  const expectedSha256 = sha256Value(value["expectedSha256"], `${path}.expectedSha256`);
  if (value["stdout"] !== undefined && typeof value["stdout"] !== "string") throw new BoundaryParseError(path, "stdout must be string");
  if (value["stderr"] !== undefined && typeof value["stderr"] !== "string") throw new BoundaryParseError(path, "stderr must be string");
  if (value["execError"] !== undefined && typeof value["execError"] !== "string") throw new BoundaryParseError(path, "execError must be string");
  if (value["markerDetected"] !== undefined && typeof value["markerDetected"] !== "boolean") throw new BoundaryParseError(path, "markerDetected must be boolean");
  if (value["appendedContentDetected"] !== undefined && typeof value["appendedContentDetected"] !== "boolean") throw new BoundaryParseError(path, "appendedContentDetected must be boolean");
  const observedBytes = value["observedBytes"] === undefined ? undefined : nonNegativeInteger(value["observedBytes"], `${path}.observedBytes`);
  const observedSha256 = value["observedSha256"] === undefined ? undefined : sha256Value(value["observedSha256"], `${path}.observedSha256`);
  return {
    exitCode,
    timedOut,
    expectedBytes,
    expectedSha256,
    ...(value["stdout"] !== undefined ? { stdout: value["stdout"] } : {}),
    ...(value["stderr"] !== undefined ? { stderr: value["stderr"] } : {}),
    ...(value["execError"] !== undefined ? { execError: value["execError"] } : {}),
    ...(value["markerDetected"] !== undefined ? { markerDetected: value["markerDetected"] } : {}),
    ...(value["appendedContentDetected"] !== undefined ? { appendedContentDetected: value["appendedContentDetected"] } : {}),
    ...(observedBytes !== undefined ? { observedBytes } : {}),
    ...(observedSha256 !== undefined ? { observedSha256 } : {}),
  };
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new BoundaryParseError(path, "expected a non-negative integer");
  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new BoundaryParseError(path, "expected boolean");
  return value;
}

function sha256Value(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new BoundaryParseError(path, "expected lowercase SHA-256 hex");
  return value;
}

function parsedCompression(layer: CapturedLayer): string | null {
  if (layer.raw === undefined) return layer.compressionLevel ?? null;
  const match = /(?:^|\n)\s*compression_level\s*=\s*"([^"]*)"\s*(?:\n|$)/.exec(layer.raw);
  return match?.[1] ?? null;
}

function layerProblem(layer: CapturedLayer): string | null {
  if (layer.readError !== undefined) return "configuration read failed";
  if (layer.malformed === true) return "configuration is malformed";
  if (layer.raw !== undefined && layer.raw.trim() !== "" && parsedCompression(layer) === null && /compression_level\s*=/.test(layer.raw)) return "configuration is malformed";
  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sentinelAssessment(sentinel: CapturedSentinel): DriftAssessment {
  if (sentinel.timedOut) return { status: "daemon_unavailable", details: ["sentinel timed out"] };
  if (sentinel.execError !== undefined) return { status: "daemon_unavailable", details: ["sentinel execution failed"] };
  if (sentinel.exitCode !== 0) return { status: "daemon_unavailable", details: ["sentinel exited nonzero"] };

  const observedBytes = sentinel.observedBytes ?? (sentinel.stdout === undefined ? undefined : new TextEncoder().encode(sentinel.stdout).byteLength);
  const observedSha256 = sentinel.observedSha256 ?? (sentinel.stdout === undefined ? undefined : sha256(sentinel.stdout));
  const hasMarker = sentinel.markerDetected === true || sentinel.stdout?.includes("[lean-ctx:") === true;
  const observed = {
    ...(observedBytes === undefined ? {} : { observedBytes }),
    ...(observedSha256 === undefined ? {} : { observedSha256 }),
  };
  if (hasMarker) return { status: "behavioral_mismatch", details: ["sentinel output contains marker"], expectedBytes: sentinel.expectedBytes, ...observed, expectedSha256: sentinel.expectedSha256 };
  if (sentinel.appendedContentDetected === true) return { status: "behavioral_mismatch", details: ["sentinel output contains appended content"], expectedBytes: sentinel.expectedBytes, ...observed, expectedSha256: sentinel.expectedSha256 };
  if (observedBytes !== sentinel.expectedBytes || observedSha256 !== sentinel.expectedSha256) return { status: "behavioral_mismatch", details: ["sentinel output bytes or hash differ"], expectedBytes: sentinel.expectedBytes, ...observed, expectedSha256: sentinel.expectedSha256 };
  return { status: "healthy", details: [] };
}

export function evaluateCapturedDrift(input: CapturedDriftInput): DriftAssessment {
  for (const layer of [input.baseline, input.global, input.project]) {
    const problem = layerProblem(layer);
    if (problem !== null) return { status: "indeterminate", details: [problem] };
  }
  const baselineLevel = parsedCompression(input.baseline);
  const globalLevel = parsedCompression(input.global);
  if (!input.baseline.present || baselineLevel === null) return { status: "indeterminate", details: ["baseline lacks explicit compression level"] };
  if (baselineLevel !== "lite" || globalLevel !== null && globalLevel !== "lite") return { status: "config_drift", details: ["baseline or global compression level is not lite"] };
  if (input.project.present) return { status: "project_override", details: ["project override is present"] };
  return sentinelAssessment(input.sentinel);
}

export function runReliabilityGates(inputs: readonly CapturedDriftInput[]): ReliabilityGates {
  const first = inputs[0];
  const g0Assessment = first === undefined ? { status: "indeterminate" as const, details: ["no captured input"] } : evaluateCapturedDrift(first);
  const statuses = inputs.map((item) => evaluateCapturedDrift(item).status);
  const requiredStatuses = new Set<DriftStatus>(DRIFT_STATUSES);
  const g1Passed = statuses.length === requiredStatuses.size && new Set(statuses).size === requiredStatuses.size && statuses.every((status) => requiredStatuses.has(status));
  return {
    g0: { passed: g0Assessment.status === "healthy", status: g0Assessment.status, details: g0Assessment.details },
    g1: { passed: g1Passed, status: g1Passed ? "healthy" : "indeterminate", details: [], statuses },
  };
}
