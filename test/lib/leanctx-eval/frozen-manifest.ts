import { GATES, PROFILES, type Expectation, type Manifest, type Scenario } from "./types";

type FrozenScenarioTuple = readonly [
  id: string,
  category: string,
  command: string,
  expectedExit: number,
  repeatCount: 1 | 2,
  expectation?: Expectation,
  allowedComparisonExitCodes?: readonly number[],
];

const FROZEN_SCENARIO_TUPLES = [
  ["src-read-small", "source-read", "sed -n '1,40p' src/admin/package.json", 0, 1],
  ["src-read-medium", "source-read", "awk 'NF' src/admin/routes/leanctx.ts | head -200", 0, 1],
  ["narrow-window", "narrow-range", "sed -n '29,40p' docs/knowledge/tooling/lean-ctx-optimization.md", 0, 1],
  ["large-read", "large-read", "cat docs/CHANGELOG.md", 0, 1],
  ["large-diagnostics", "diagnostics", "grep -rn TODO src/admin/lib | head -400", 0, 1],
  ["chained-pipeline", "pipeline", "cat Dockerfile | wc -l && printf 'chained-ok\\n'", 0, 1],
  ["git-log", "git-output", "git -C /repo log --oneline -50", 0, 1],
  ["git-show-stat", "git-output", "git -C /repo show --stat --format=%H HEAD", 0, 1],
  ["json-contract", "json-output", "jq -S '.required' test/fixtures/leanctx-evaluation.schema.json", 0, 1],
  ["json-package", "json-output", "jq -S '{name,type,scripts}' src/admin/package.json", 0, 1],
  ["path-reject", "path-jail", "cat /etc/hostname", 0, 1, "reject-allowed", [1, 2]],
  ["tree-listing", "path-jail", "find src/admin/lib -maxdepth 1 -name '*.ts' | sort", 0, 1],
  ["stderr-error", "error-output", "ls /nonexistent-lc-eval-path", 2, 1, "both-nonzero", [1, 2]],
  ["od-bytes", "byte-output", "od -c docker/lean-ctx/config.default.toml | head -20", 0, 1],
  ["stat-file", "metadata-output", "stat docker/lean-ctx/config.default.toml", 0, 1],
  ["head-whole-file", "large-read", "head -100 docs/TOOLING.md", 0, 1],
  ["cjk-content", "triage-shape", "grep -c '設定' docs/knowledge/tooling/lean-ctx-optimization.md", 0, 1],
  ["longest-line", "triage-shape", "awk 'length($0)>n{n=length($0)} END{print n}' docs/CHANGELOG.md", 0, 1],
  ["repeat-stability", "repeatability", "sed -n '1,40p' src/admin/package.json", 0, 2],
  ["wc-lc", "byte-output", "wc -lc docs/ARCHITECTURE.md", 0, 1],
] as const satisfies readonly FrozenScenarioTuple[];

function makeScenario(tuple: FrozenScenarioTuple): Scenario {
  const [id, category, command, expectedExit, repeatCount, expectation = "exact-equal", allowedComparisonExitCodes = []] = tuple;
  return { id, category, command, cwd: "/repo", readOnly: true, expectation, expectedExit, allowedComparisonExitCodes, repeatCount };
}

export const FROZEN_SCENARIOS: readonly Scenario[] = FROZEN_SCENARIO_TUPLES.map(makeScenario);

export const FROZEN_MANIFEST: Manifest = {
  contractVersion: "r2",
  profiles: PROFILES,
  gates: GATES,
  scenarios: FROZEN_SCENARIOS,
};
