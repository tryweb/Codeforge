import { sha256 } from "./boundary";
import { evaluate } from "./evaluate";
import { FROZEN_MANIFEST, FROZEN_SCENARIOS } from "./frozen-manifest";
import { hashCanonical } from "./boundary";
import type { Evaluation, Manifest, NormalizedRecord } from "./types";

export type Todo6Gate = { readonly gate: "G3" | "G4"; readonly passed: boolean; readonly details: readonly string[] };
export type Todo6Gates = { readonly g3: Todo6Gate; readonly g4: Todo6Gate };

export function runTodo6Gates(manifest: Manifest, records: readonly NormalizedRecord[]): Todo6Gates {
  const evaluation = evaluate(manifest, records);
  const details: string[] = [];
  if (hashCanonical(manifest) !== hashCanonical(FROZEN_MANIFEST)) details.push("manifest does not match the complete frozen contract");
  if (records.length !== 40) details.push("normalized record count is not 40");
  const expectedKeys = new Set(FROZEN_SCENARIOS.flatMap((scenario) => [
    `${scenario.id}:lossless`,
    `${scenario.id}:comparison`,
  ]));
  const keys = new Set(records.map((record) => `${record.scenarioId}:${record.profile}`));
  if (keys.size !== records.length) details.push("normalized records contain duplicate pairs");
  if (keys.size !== expectedKeys.size || [...expectedKeys].some((key) => !keys.has(key)) || [...keys].some((key) => !expectedKeys.has(key))) details.push("normalized records do not exactly match the frozen 40-pair contract");
  for (const record of records) {
    if (record.incidents === undefined) details.push(`incident ledger missing for ${record.scenarioId}:${record.profile}`);
    for (const capture of [record.direct, record.leanctx]) {
      if (capture.stdout === undefined || capture.stderr === undefined) details.push(`capture streams missing for ${record.scenarioId}:${record.profile}`);
      if (capture.stdoutSha256 !== sha256(capture.stdout) || capture.stderrSha256 !== sha256(capture.stderr)) details.push(`capture hash is not independently verifiable for ${record.scenarioId}:${record.profile}`);
    }
  }
  const g3 = { gate: "G3" as const, passed: details.length === 0, details };
  const expectedRetain = evaluation.incidents.length === 0 && evaluation.verdict.metricsComplete && evaluation.verdict.netBenefitPercent !== null && evaluation.verdict.netBenefitPercent >= 20;
  const g4Details = evaluation.verdict.verdict === (expectedRetain ? "retain" : "disable-routing") ? [] : ["verdict does not implement the checked-in retain/disable rule"];
  return { g3, g4: { gate: "G4", passed: g4Details.length === 0, details: g4Details } };
}
