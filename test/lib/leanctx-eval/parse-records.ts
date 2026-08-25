import {
  BoundaryParseError,
  booleanValue,
  hasOnlyKeys,
  isRecord,
  nonNegativeInteger,
  parseJson,
  required,
  stringValue,
} from "./boundary";
import { PROFILES, type Capture, type IncidentKind, type Manifest, type NormalizedRecord, type Profile, type TrustedTokenMetrics } from "./types";

const RECORD_KEYS = ["scenarioId", "profile", "direct", "leanctx", "outputEqual", "exitContractSatisfied", "tokenMetrics", "incidents"] as const;
const CAPTURE_KEYS = ["stdout", "stderr", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256", "exitCode", "durationMs", "timedOut", "markerDetected", "appendedContentDetected"] as const;
const METRIC_KEYS = ["source", "scope", "tokensOut", "tokensIn"] as const;

export type TokenMetricClaim = {
  readonly source: "runtime";
  readonly scope: "call" | "session";
  readonly tokensOut: number;
  readonly tokensIn?: number;
};

export type TokenMetricBinding = {
  readonly scenarioId: string;
  readonly profile: Profile;
  readonly direct: Capture;
  readonly leanctx: Capture;
};

export type TokenMetricVerifier = (claim: TokenMetricClaim, binding: TokenMetricBinding) => TrustedTokenMetrics | null;

export function parseRecordsJson(text: string, manifest?: Manifest, profiles: readonly Profile[] = PROFILES, verifier?: TokenMetricVerifier): readonly NormalizedRecord[] {
  return parseRecords(parseJson(text, "records"), manifest, profiles, verifier);
}

export function parseRecords(value: unknown, manifest?: Manifest, profiles: readonly Profile[] = PROFILES, verifier?: TokenMetricVerifier): readonly NormalizedRecord[] {
  if (!Array.isArray(value)) throw new BoundaryParseError("records", "expected an array");
  const expectedCount = manifest === undefined ? 40 : manifest.scenarios.length * profiles.length;
  if (value.length !== expectedCount) throw new BoundaryParseError("records", `record count ${value.length}; missing or extra records (expected exactly ${expectedCount})`);
  const records = value.map((record, index) => parseRecord(record, index, verifier));
  const keys = new Set<string>();
  for (const record of records) {
    const key = `${record.scenarioId}:${record.profile}`;
    if (keys.has(key)) throw new BoundaryParseError("records", `duplicate record ${key}`);
    keys.add(key);
  }
  if (manifest) validatePairing(records, manifest, profiles);
  return records;
}

function parseRecord(value: unknown, index: number, verifier?: TokenMetricVerifier): NormalizedRecord {
  const path = `records[${index}]`;
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected an object");
  hasOnlyKeys(value, RECORD_KEYS, path);
  const scenarioId = stringValue(required(value, "scenarioId", path), `${path}.scenarioId`);
  const profile = parseProfile(required(value, "profile", path), `${path}.profile`);
  const direct = parseCapture(required(value, "direct", path), `${path}.direct`);
  const leanctx = parseCapture(required(value, "leanctx", path), `${path}.leanctx`);
  const outputEqual = booleanValue(required(value, "outputEqual", path), `${path}.outputEqual`);
  const exitContractSatisfied = booleanValue(required(value, "exitContractSatisfied", path), `${path}.exitContractSatisfied`);
  const tokenMetrics = parseTokenMetrics(required(value, "tokenMetrics", path), `${path}.tokenMetrics`, { scenarioId, profile, direct, leanctx }, verifier);
  const incidents = parseIncidents(required(value, "incidents", path), `${path}.incidents`);
  return { scenarioId, profile, direct, leanctx, outputEqual, exitContractSatisfied, tokenMetrics, incidents };
}

function parseProfile(value: unknown, path: string): Profile {
  const profile = stringValue(value, path);
  switch (profile) {
    case "lossless":
    case "comparison":
      return profile;
    default:
      throw new BoundaryParseError(path, "unknown profile");
  }
}

function parseCapture(value: unknown, path: string): Capture {
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected an object");
  hasOnlyKeys(value, CAPTURE_KEYS, path);
  const stdout = required(value, "stdout", path);
  const stderr = required(value, "stderr", path);
  if (typeof stdout !== "string") throw new BoundaryParseError(`${path}.stdout`, "expected string");
  if (typeof stderr !== "string") throw new BoundaryParseError(`${path}.stderr`, "expected string");
  const stdoutBytes = nonNegativeInteger(required(value, "stdoutBytes", path), `${path}.stdoutBytes`);
  const stderrBytes = nonNegativeInteger(required(value, "stderrBytes", path), `${path}.stderrBytes`);
  const stdoutSha256 = stringValue(required(value, "stdoutSha256", path), `${path}.stdoutSha256`);
  const stderrSha256 = stringValue(required(value, "stderrSha256", path), `${path}.stderrSha256`);
  if (!/^[a-f0-9]{64}$/.test(stdoutSha256) || !/^[a-f0-9]{64}$/.test(stderrSha256)) {
    throw new BoundaryParseError(path, "capture hashes must be lowercase SHA-256");
  }
  const exitCode = nonNegativeInteger(required(value, "exitCode", path), `${path}.exitCode`);
  if (exitCode > 255) throw new BoundaryParseError(`${path}.exitCode`, "must be 0..255");
  const durationMs = nonNegativeInteger(required(value, "durationMs", path), `${path}.durationMs`);
  const timedOut = booleanValue(required(value, "timedOut", path), `${path}.timedOut`);
  const markerDetected = booleanValue(required(value, "markerDetected", path), `${path}.markerDetected`);
  const appendedContentDetected = booleanValue(required(value, "appendedContentDetected", path), `${path}.appendedContentDetected`);
  return {
    stdout,
    stderr,
    stdoutBytes,
    stderrBytes,
    stdoutSha256,
    stderrSha256,
    exitCode,
    durationMs,
    timedOut,
    markerDetected,
    appendedContentDetected,
  };
}

function parseTokenMetrics(value: unknown, path: string, binding: TokenMetricBinding, verifier?: TokenMetricVerifier): TrustedTokenMetrics | null {
  if (value === null) return null;
  if (verifier === undefined) throw new BoundaryParseError(path, "non-null token metrics require an independent trusted verifier");
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected object or null");
  hasOnlyKeys(value, METRIC_KEYS, path);
  if (required(value, "source", path) !== "runtime") throw new BoundaryParseError(`${path}.source`, "must be runtime");
  const scope = parseMetricScope(stringValue(required(value, "scope", path), `${path}.scope`), path);
  const tokensOut = nonNegativeInteger(required(value, "tokensOut", path), `${path}.tokensOut`);
  const tokensInValue = value["tokensIn"];
  const claim = tokensInValue === undefined
    ? { source: "runtime" as const, scope, tokensOut }
    : { source: "runtime" as const, scope, tokensOut, tokensIn: nonNegativeInteger(tokensInValue, `${path}.tokensIn`) };
  const trusted = verifier(claim, binding);
  if (trusted === null) throw new BoundaryParseError(path, "token metrics did not match independent trusted evidence");
  return trusted;
}

function parseMetricScope(value: string, path: string): TokenMetricClaim["scope"] {
  switch (value) {
    case "call":
    case "session":
      return value;
    default:
      throw new BoundaryParseError(`${path}.scope`, "must be call or session");
  }
}

function parseIncidents(value: unknown, path: string): readonly IncidentKind[] {
  if (!Array.isArray(value)) throw new BoundaryParseError(path, "expected an array");
  return value.map((item, index) => parseIncidentKind(item, `${path}[${index}]`));
}

function parseIncidentKind(value: unknown, path: string): IncidentKind {
  const kind = stringValue(value, path);
  switch (kind) {
    case "timeout":
    case "marker":
    case "appended-content":
    case "output-mismatch":
    case "unexpected-exit":
    case "duplicate-record":
    case "missing-record":
    case "unknown-record":
      return kind;
    default:
      throw new BoundaryParseError(path, "unknown incident kind");
  }
}

function validatePairing(records: readonly NormalizedRecord[], manifest: Manifest, profiles: readonly Profile[]): void {
  const scenarios = new Set(manifest.scenarios.map((scenario) => scenario.id));
  const expected = new Set<string>();
  for (const scenario of manifest.scenarios) {
    for (const profile of profiles) expected.add(`${scenario.id}:${profile}`);
  }
  for (const record of records) {
    if (!scenarios.has(record.scenarioId)) throw new BoundaryParseError("records", `unknown scenario ${record.scenarioId}`);
  }
  for (const key of expected) {
    if (!records.some((record) => `${record.scenarioId}:${record.profile}` === key)) {
      throw new BoundaryParseError("records", `missing record ${key}`);
    }
  }
}
