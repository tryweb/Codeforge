export const PROFILES = ["lossless", "comparison"] as const;
export type Profile = (typeof PROFILES)[number];

export const EXPECTATIONS = ["exact-equal", "reject-allowed", "both-nonzero"] as const;
export type Expectation = (typeof EXPECTATIONS)[number];

export const GATES = ["G0", "G1", "G2", "G3", "G4"] as const;
export type Gate = (typeof GATES)[number];

export const INCIDENT_KINDS = [
  "timeout",
  "marker",
  "appended-content",
  "output-mismatch",
  "unexpected-exit",
  "duplicate-record",
  "missing-record",
  "unknown-record",
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export type Scenario = {
  readonly id: string;
  readonly category: string;
  readonly command: string;
  readonly cwd: "/repo";
  readonly readOnly: true;
  readonly expectation: Expectation;
  readonly expectedExit: number;
  readonly allowedComparisonExitCodes: readonly number[];
  readonly repeatCount: 1 | 2;
};

export type Manifest = {
  readonly contractVersion: "r2";
  readonly profiles: readonly ["lossless", "comparison"];
  readonly gates: readonly ["G0", "G1", "G2", "G3", "G4"];
  readonly scenarios: readonly Scenario[];
};

export type Capture = {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly markerDetected: boolean;
  readonly appendedContentDetected: boolean;
};

export type TrustedTokenMetrics = {
  readonly source: "runtime";
  readonly scope: "call" | "session";
  readonly tokensOut: number;
  readonly tokensIn?: number;
};

export type NormalizedRecord = {
  readonly scenarioId: string;
  readonly profile: Profile;
  readonly direct: Capture;
  readonly leanctx: Capture;
  readonly outputEqual: boolean;
  readonly exitContractSatisfied: boolean;
  readonly tokenMetrics: TrustedTokenMetrics | null;
  readonly incidents: readonly IncidentKind[];
};

export type Incident = {
  readonly scenarioId: string | null;
  readonly profile: Profile | null;
  readonly kind: IncidentKind;
  readonly detail: string;
};

export type Verdict = {
  readonly verdict: "retain" | "disable-routing";
  readonly incidents: number;
  readonly metricsComplete: boolean;
  readonly netBenefitPercent: number | null;
  readonly recordCount: number;
  readonly scenarioCount: number;
  readonly reasons: readonly string[];
};

export type Evaluation = {
  readonly manifestHash: string;
  readonly normalizedRecordsHash: string;
  readonly incidents: readonly Incident[];
  readonly verdict: Verdict;
  readonly records: readonly NormalizedRecord[];
};

export function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${String(value)}`);
}
