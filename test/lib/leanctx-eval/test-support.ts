import { createHash } from "node:crypto";
import type { Capture, NormalizedRecord } from "./types";
import { FROZEN_SCENARIOS } from "./frozen-manifest";
import type { TokenMetricVerifier } from "./parse-records";

export const SCENARIO_IDS = [
  "src-read-small",
  "src-read-medium",
  "narrow-window",
  "large-read",
  "large-diagnostics",
  "chained-pipeline",
  "git-log",
  "git-show-stat",
  "json-contract",
  "json-package",
  "path-reject",
  "tree-listing",
  "stderr-error",
  "od-bytes",
  "stat-file",
  "head-whole-file",
  "cjk-content",
  "longest-line",
  "repeat-stability",
  "wc-lc",
] as const;

export const fixtureTokenMetricVerifier: TokenMetricVerifier = (claim) => claim;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createManifestInput(): Record<string, unknown> {
  return {
    contractVersion: "r2",
    profiles: ["lossless", "comparison"],
    gates: ["G0", "G1", "G2", "G3", "G4"],
    scenarios: FROZEN_SCENARIOS,
  };
}

type CaptureOverrides = Partial<Capture>;

export function createCapture(overrides: CaptureOverrides = {}): Capture {
  return {
    stdout: "ok\n",
    stderr: "",
    stdoutBytes: 3,
    stderrBytes: 0,
    stdoutSha256: sha256("ok\n"),
    stderrSha256: sha256(""),
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    markerDetected: false,
    appendedContentDetected: false,
    ...overrides,
  };
}

export function createRecordsInput(
  overrides: (scenarioId: string, profile: "lossless" | "comparison") => CaptureOverrides = () => ({}),
  tokenOut: (profile: "lossless" | "comparison") => number = (profile) =>
    profile === "lossless" ? 100 : 75,
): NormalizedRecord[] {
  return FROZEN_SCENARIOS.flatMap((scenario) =>
    (["lossless", "comparison"] as const).map((profile) => ({
      scenarioId: scenario.id,
      profile,
      direct: createCapture({ exitCode: scenario.expectedExit }),
      leanctx: createCapture({ ...overrides(scenario.id, profile), exitCode: scenario.expectedExit }),
      outputEqual: true,
      exitContractSatisfied: true,
      tokenMetrics: {
        source: "runtime",
        scope: "call",
        tokensOut: tokenOut(profile),
      },
      incidents: [],
    })),
  );
}

export function createRunInput(
  records = createRecordsInput(),
): { readonly manifest: Record<string, unknown>; readonly records: Record<string, unknown>[] } {
  return { manifest: createManifestInput(), records };
}
