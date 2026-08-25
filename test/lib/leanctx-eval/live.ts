import { mkdir, readFile, writeFile } from "node:fs/promises";
import { capturePair, makeCapture } from "./capture";
import { compareCaptures, evaluate } from "./evaluate";
import { parseManifestJson } from "./parse-manifest";
import { parseRecordsJson } from "./parse-records";
import { renderMarkdown, renderVerdictJson } from "./render";
import { runTodo6Gates } from "./todo6-gates";
import type { CapturePair } from "./capture";
import type { NormalizedRecord, Profile, Scenario } from "./types";

const manifestPath = argument("--manifest");
const outDir = argument("--out-dir");
const profiles: readonly Profile[] = ["lossless", "comparison"];
export const PROFILE_COMPRESSION = { lossless: "off", comparison: "lite" } as const;

if (import.meta.main) {
  await runLive(process.argv.slice(2));
}

async function runLive(args: readonly string[]): Promise<void> {
  const command = args[0];
  if (command !== "selfcheck" && command !== "campaign") throw new Error("usage: selfcheck|campaign --manifest PATH --out-dir PATH");
  const selectedManifest = manifestPath ?? argumentFrom(args, "--manifest");
  const selectedOutDir = outDir ?? argumentFrom(args, "--out-dir");
  if (selectedManifest === undefined || selectedOutDir === undefined) throw new Error("--manifest and --out-dir are required");
  const manifest = parseManifestJson(await readFile(selectedManifest, "utf8"));
  await mkdir(selectedOutDir, { recursive: true });
  const profile = argumentFrom(args, "--profile");
  const selectedProfile = isProfile(profile) ? profile : null;
  if (command === "campaign" && selectedProfile === null) throw new Error("campaign requires --profile lossless|comparison");
  const records = command === "selfcheck" ? syntheticRecords(manifest.scenarios) : await runProfile(manifest.scenarios, selectedProfile ?? "lossless", (scenario) => capturePair(scenario.command, { cwd: "/repo" }));
  const parsedRecords = parseRecordsJson(JSON.stringify(records), manifest, selectedProfile === null ? profiles : [selectedProfile]);
  await writeFile(`${selectedOutDir}/records.json`, `${JSON.stringify(parsedRecords)}\n`);
  const evaluation = evaluate(manifest, parsedRecords);
  if (command === "selfcheck") await writeFile(`${selectedOutDir}/gates.json`, `${JSON.stringify(runTodo6Gates(manifest, parsedRecords))}\n`);
  await writeFile(`${selectedOutDir}/verdict.json`, renderVerdictJson(evaluation));
  await writeFile(`${selectedOutDir}/report.md`, renderMarkdown(evaluation));
  if (command === "campaign" && records.length !== 20) throw new Error("profile run did not produce exactly 20 records");
}

function syntheticRecords(scenarios: readonly Scenario[]): readonly NormalizedRecord[] {
  return scenarios.flatMap((scenario) => profiles.map((profile) => {
    const direct = stableCapture(scenario.expectedExit);
    const leanctx = stableCapture(scenario.expectedExit);
    return { scenarioId: scenario.id, profile, direct, leanctx, ...compareCaptures(scenario, direct, leanctx), tokenMetrics: null, incidents: [] };
  }));
}

export async function runProfile(scenarios: readonly Scenario[], profile: Profile, runner: (scenario: Scenario) => Promise<CapturePair>): Promise<readonly NormalizedRecord[]> {
  const records: NormalizedRecord[] = [];
  for (const scenario of scenarios) {
    const pair = await runner(scenario);
    let repeatMismatch = false;
    if (scenario.repeatCount === 2) {
      const repeat = await runner(scenario);
      if (!sameRepeatCapture(pair.direct, repeat.direct) || !sameRepeatCapture(pair.leanctx, repeat.leanctx)) {
        repeatMismatch = true;
      }
    }
    records.push({ scenarioId: scenario.id, profile, direct: pair.direct, leanctx: pair.leanctx, ...compareCaptures(scenario, pair.direct, pair.leanctx), tokenMetrics: null, incidents: repeatMismatch ? ["output-mismatch"] : [] });
  }
  return records;
}

function sameRepeatCapture(first: NormalizedRecord["direct"], second: NormalizedRecord["direct"]): boolean {
  return first.stdoutBytes === second.stdoutBytes && first.stderrBytes === second.stderrBytes && first.stdoutSha256 === second.stdoutSha256 && first.stderrSha256 === second.stderrSha256 && first.exitCode === second.exitCode && first.timedOut === second.timedOut && first.markerDetected === second.markerDetected && first.appendedContentDetected === second.appendedContentDetected;
}

function stableCapture(exitCode: number) {
  return makeCapture("selfcheck\n", "", exitCode, 0, false);
}

function argument(name: string): string | undefined { return argumentFrom(process.argv.slice(2), name); }
function argumentFrom(args: readonly string[], name: string): string | undefined { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function isProfile(value: string | undefined): value is Profile { return value === "lossless" || value === "comparison"; }
