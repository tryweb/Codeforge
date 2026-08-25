import { canonicalJson } from "./boundary";
import type { Evaluation } from "./types";

export function renderVerdictJson(evaluation: Evaluation): string {
  return canonicalJson({
    contractVersion: "r2",
    manifestHash: evaluation.manifestHash,
    normalizedRecordsHash: evaluation.normalizedRecordsHash,
    incidents: evaluation.incidents,
    verdict: evaluation.verdict,
  });
}

export function renderMarkdown(evaluation: Evaluation): string {
  const verdict = evaluation.verdict;
  const benefit = verdict.netBenefitPercent === null ? "unavailable" : `${verdict.netBenefitPercent.toFixed(2)}%`;
  const lines = [
    "# Lean Context Evaluation",
    "",
    `- Verdict: **${verdict.verdict}**`,
    `- Net benefit: **${benefit}**`,
    `- Incidents: **${verdict.incidents}**`,
    `- Metrics complete: **${verdict.metricsComplete}**`,
    `- Records: **${verdict.recordCount}/40**`,
    `- Scenarios: **${verdict.scenarioCount}/20**`,
    `- Manifest hash: \`${evaluation.manifestHash}\``,
    `- Normalized records hash: \`${evaluation.normalizedRecordsHash}\``,
    "",
    "## Reasons",
    "",
    ...(verdict.reasons.length === 0 ? ["- none"] : verdict.reasons.map((reason) => `- ${reason}`)),
    "",
  ];
  return lines.join("\n");
}
