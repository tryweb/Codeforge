import { canonicalJson, hashCanonical, sha256 } from "./boundary";
import { assertNever, type Capture, type Evaluation, type Expectation, type Incident, type IncidentKind, type Manifest, type NormalizedRecord, type Profile, type Scenario, type Verdict } from "./types";

export function evaluate(manifest: Manifest, records: readonly NormalizedRecord[]): Evaluation {
  const structuralIncidents = validateRecordSet(manifest, records);
  const incidents = [...structuralIncidents, ...records.flatMap((record) => evaluateRecord(manifest, record))].sort(incidentOrder);
  const metricResult = calculateMetrics(manifest, records);
  const reasons = buildReasons(incidents, metricResult.complete, records.length, manifest.scenarios.length, metricResult.netBenefitPercent);
  const verdict: Verdict = {
    verdict: reasons.length === 0 ? "retain" : "disable-routing",
    incidents: incidents.length,
    metricsComplete: metricResult.complete,
    netBenefitPercent: metricResult.netBenefitPercent,
    recordCount: records.length,
    scenarioCount: manifest.scenarios.length,
    reasons,
  };
  return {
    manifestHash: hashCanonical({ ...manifest, scenarios: [...manifest.scenarios].sort((left, right) => left.id.localeCompare(right.id)) }),
    normalizedRecordsHash: hashCanonical([...records].sort(recordOrder)),
    incidents,
    verdict,
    records,
  };
}

type MetricResult = {
  readonly complete: boolean;
  readonly netBenefitPercent: number | null;
};

function calculateMetrics(manifest: Manifest, records: readonly NormalizedRecord[]): MetricResult {
  const expectedKeys = new Set(manifest.scenarios.flatMap((scenario) => [`${scenario.id}:lossless`, `${scenario.id}:comparison`]));
  const byKey = new Map(records.map((record) => [`${record.scenarioId}:${record.profile}`, record]));
  if (records.length !== 40 || byKey.size !== expectedKeys.size || [...expectedKeys].some((key) => !byKey.has(key))) {
    return { complete: false, netBenefitPercent: null };
  }
  let lossless = 0;
  let comparison = 0;
  for (const scenario of manifest.scenarios) {
    const losslessRecord = byKey.get(`${scenario.id}:lossless`);
    const comparisonRecord = byKey.get(`${scenario.id}:comparison`);
    if (losslessRecord?.tokenMetrics === null || comparisonRecord?.tokenMetrics === null || losslessRecord === undefined || comparisonRecord === undefined) {
      return { complete: false, netBenefitPercent: null };
    }
    lossless += losslessRecord.tokenMetrics.tokensOut;
    comparison += comparisonRecord.tokenMetrics.tokensOut;
  }
  if (lossless <= 0) return { complete: false, netBenefitPercent: null };
  return { complete: true, netBenefitPercent: (100 * (lossless - comparison)) / lossless };
}

function validateRecordSet(manifest: Manifest, records: readonly NormalizedRecord[]): readonly Incident[] {
  const incidents: Incident[] = [];
  const expected = new Set(manifest.scenarios.flatMap((scenario) => PROFILES.map((profile) => `${scenario.id}:${profile}`)));
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.scenarioId}:${record.profile}`;
    if (!manifest.scenarios.some((scenario) => scenario.id === record.scenarioId)) {
      incidents.push({ scenarioId: record.scenarioId, profile: record.profile, kind: "unknown-record", detail: `unknown scenario ${record.scenarioId}` });
    }
    if (seen.has(key)) incidents.push({ scenarioId: record.scenarioId, profile: record.profile, kind: "duplicate-record", detail: `duplicate record ${key}` });
    seen.add(key);
  }
  for (const key of expected) {
    if (!seen.has(key)) {
      const [scenarioId, profileText] = key.split(":");
      const profile = profileText === "lossless" || profileText === "comparison" ? profileText : null;
      incidents.push({ scenarioId: scenarioId ?? null, profile, kind: "missing-record", detail: `missing record ${key}` });
    }
  }
  if (records.length !== 40) incidents.push({ scenarioId: null, profile: null, kind: "missing-record", detail: `record count ${records.length}, expected 40` });
  return incidents;
}

const PROFILES: readonly Profile[] = ["lossless", "comparison"];

function evaluateRecord(manifest: Manifest, record: NormalizedRecord): readonly Incident[] {
  const scenario = manifest.scenarios.find((candidate) => candidate.id === record.scenarioId);
  if (scenario === undefined) return record.incidents.map((kind) => incidentFor(record, kind, "record-declared incident"));
  const incidents = [
    ...record.incidents.map((kind) => incidentFor(record, kind, "record-declared incident")),
    ...captureIncidents(record),
  ];
  const comparison = compareCaptures(scenario, record.direct, record.leanctx);
  if (!comparison.outputEqual && scenario.expectation === "exact-equal") {
    incidents.push(incidentFor(record, "output-mismatch", "exact-equal output hashes, bytes, or exit differ"));
  }
  if (!comparison.exitContractSatisfied) incidents.push(incidentFor(record, "unexpected-exit", "declared exit contract is not satisfied"));
  if (record.outputEqual !== comparison.outputEqual && scenario.expectation === "exact-equal") {
    incidents.push(incidentFor(record, "output-mismatch", "outputEqual does not match captures"));
  }
  if (record.exitContractSatisfied !== comparison.exitContractSatisfied) {
    incidents.push(incidentFor(record, "unexpected-exit", "exitContractSatisfied does not match captures"));
  }
  return incidents;
}

function captureIncidents(record: NormalizedRecord): readonly Incident[] {
  const incidents: Incident[] = [];
  for (const capture of [record.direct, record.leanctx]) {
    if (capture.timedOut) incidents.push(incidentFor(record, "timeout", "capture timed out"));
    if (capture.markerDetected) incidents.push(incidentFor(record, "marker", "capture contains a lean-ctx marker"));
    if (capture.appendedContentDetected) incidents.push(incidentFor(record, "appended-content", "capture contains appended content"));
    if (capture.stdout !== undefined && (capture.stdoutBytes !== new TextEncoder().encode(capture.stdout).byteLength || capture.stdoutSha256 !== sha256(capture.stdout))) {
      incidents.push(incidentFor(record, "output-mismatch", "stdout hash or byte count does not match captured output"));
    }
    if (capture.stderr !== undefined && (capture.stderrBytes !== new TextEncoder().encode(capture.stderr).byteLength || capture.stderrSha256 !== sha256(capture.stderr))) {
      incidents.push(incidentFor(record, "output-mismatch", "stderr hash or byte count does not match captured output"));
    }
  }
  return incidents;
}

export function compareCaptures(scenario: Scenario, direct: Capture, leanctx: Capture): { readonly outputEqual: boolean; readonly exitContractSatisfied: boolean } {
  const outputEqual = direct.stdoutSha256 === leanctx.stdoutSha256 && direct.stdoutBytes === leanctx.stdoutBytes && direct.stderrSha256 === leanctx.stderrSha256 && direct.stderrBytes === leanctx.stderrBytes && direct.exitCode === leanctx.exitCode;
  let exitContractSatisfied = false;
  switch (scenario.expectation) {
    case "exact-equal":
      exitContractSatisfied = direct.exitCode === scenario.expectedExit && leanctx.exitCode === scenario.expectedExit;
      break;
    case "reject-allowed":
      exitContractSatisfied = direct.exitCode === scenario.expectedExit && allowedComparisonExit(scenario, leanctx.exitCode);
      break;
    case "both-nonzero":
      exitContractSatisfied = direct.exitCode === scenario.expectedExit && leanctx.exitCode !== 0 && allowedComparisonExit(scenario, leanctx.exitCode);
      break;
    default:
      return assertNever(scenario.expectation);
  }
  return { outputEqual, exitContractSatisfied };
}

function allowedComparisonExit(scenario: Scenario, exitCode: number): boolean {
  return exitCode === scenario.expectedExit || scenario.allowedComparisonExitCodes.length === 0 || scenario.allowedComparisonExitCodes.includes(exitCode);
}

function incidentFor(record: NormalizedRecord, kind: IncidentKind, detail: string): Incident {
  return { scenarioId: record.scenarioId, profile: record.profile, kind, detail };
}

function buildReasons(incidents: readonly Incident[], metricsComplete: boolean, recordCount: number, scenarioCount: number, netBenefitPercent: number | null): readonly string[] {
  const reasons: string[] = [];
  if (incidents.length > 0) reasons.push(`${incidents.length} integrity incident(s)`);
  if (!metricsComplete) reasons.push("trusted token metrics are incomplete or denominator is zero");
  if (recordCount !== 40) reasons.push(`record count is ${recordCount}, expected 40`);
  if (scenarioCount !== 20) reasons.push(`scenario count is ${scenarioCount}, expected 20`);
  if (netBenefitPercent === null || netBenefitPercent < 20) reasons.push("net benefit is below 20.00%");
  return reasons;
}

function recordOrder(left: NormalizedRecord, right: NormalizedRecord): number {
  return left.scenarioId.localeCompare(right.scenarioId) || left.profile.localeCompare(right.profile);
}

function incidentOrder(left: Incident, right: Incident): number {
  return (left.scenarioId ?? "").localeCompare(right.scenarioId ?? "") || (left.profile ?? "").localeCompare(right.profile ?? "") || left.kind.localeCompare(right.kind) || left.detail.localeCompare(right.detail);
}

export function canonicalEvaluationJson(evaluation: Evaluation): string {
  return canonicalJson({ manifestHash: evaluation.manifestHash, normalizedRecordsHash: evaluation.normalizedRecordsHash, incidents: evaluation.incidents, verdict: evaluation.verdict });
}
