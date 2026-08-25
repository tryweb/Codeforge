import {
  BoundaryParseError,
  hasOnlyKeys,
  canonicalJson,
  integerValue,
  isRecord,
  parseJson,
  required,
  stringValue,
} from "./boundary";
import { GATES, PROFILES, type Expectation, type Manifest, type Scenario } from "./types";
import { FROZEN_SCENARIOS } from "./frozen-manifest";

const ROOT_KEYS = ["$schema", "contractVersion", "profiles", "gates", "scenarios"] as const;
const SCENARIO_KEYS = [
  "id",
  "category",
  "command",
  "cwd",
  "readOnly",
  "expectation",
  "expectedExit",
  "allowedComparisonExitCodes",
  "repeatCount",
] as const;

export function parseManifestJson(text: string): Manifest {
  return parseManifest(parseJson(text, "manifest"));
}

export function parseManifest(value: unknown): Manifest {
  if (!isRecord(value)) throw new BoundaryParseError("manifest", "expected an object");
  hasOnlyKeys(value, ROOT_KEYS, "manifest");
  if (required(value, "contractVersion", "manifest") !== "r2") {
    throw new BoundaryParseError("manifest.contractVersion", "must be r2");
  }
  const profilesValue = required(value, "profiles", "manifest.profiles");
  if (!Array.isArray(profilesValue) || profilesValue.length !== 2 || profilesValue[0] !== PROFILES[0] || profilesValue[1] !== PROFILES[1]) {
    throw new BoundaryParseError("manifest.profiles", "must be [lossless, comparison]");
  }
  const gatesValue = required(value, "gates", "manifest.gates");
  if (!Array.isArray(gatesValue) || gatesValue.length !== GATES.length || gatesValue.some((gate, index) => gate !== GATES[index])) {
    throw new BoundaryParseError("manifest.gates", "must be [G0, G1, G2, G3, G4]");
  }
  const scenariosValue = required(value, "scenarios", "manifest.scenarios");
  if (!Array.isArray(scenariosValue) || scenariosValue.length !== 20) {
    throw new BoundaryParseError("manifest.scenarios", "must contain exactly 20 scenarios");
  }
  const scenarios = scenariosValue.map((scenario, index) => parseScenario(scenario, index));
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new BoundaryParseError("manifest.scenarios", `duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
  }
  const mismatch = scenarios.findIndex((scenario, index) => !sameFrozenScenario(scenario, FROZEN_SCENARIOS[index]));
  if (mismatch >= 0) throw new BoundaryParseError("manifest.scenarios", "scenario differs from frozen Todo 6 contract");
  return {
    contractVersion: "r2",
    profiles: ["lossless", "comparison"],
    gates: ["G0", "G1", "G2", "G3", "G4"],
    scenarios,
  };
}

function sameFrozenScenario(actual: Scenario, expected: Scenario | undefined): boolean {
  return expected !== undefined && actual.id === expected.id && actual.category === expected.category && actual.command === expected.command && actual.cwd === expected.cwd && actual.readOnly === expected.readOnly && actual.expectation === expected.expectation && actual.expectedExit === expected.expectedExit && actual.repeatCount === expected.repeatCount && actual.allowedComparisonExitCodes.length === expected.allowedComparisonExitCodes.length && actual.allowedComparisonExitCodes.every((code, index) => code === expected.allowedComparisonExitCodes[index]);
}

function parseScenario(value: unknown, index: number): Scenario {
  const path = `manifest.scenarios[${index}]`;
  if (!isRecord(value)) throw new BoundaryParseError(path, "expected an object");
  hasOnlyKeys(value, SCENARIO_KEYS, path);
  const id = stringValue(required(value, "id", path), `${path}.id`);
  if (!/^[a-z0-9-]+$/.test(id)) throw new BoundaryParseError(`${path}.id`, "must contain lowercase letters, digits, and hyphens");
  const category = stringValue(required(value, "category", path), `${path}.category`);
  const command = stringValue(required(value, "command", path), `${path}.command`);
  if (command.trim() === "") throw new BoundaryParseError(`${path}.command`, "must not be empty");
  if (isWriteBearingCommand(command)) throw new BoundaryParseError(`${path}.command`, "write-bearing command is forbidden");
  if (required(value, "cwd", path) !== "/repo") throw new BoundaryParseError(`${path}.cwd`, "must be /repo");
  if (required(value, "readOnly", path) !== true) throw new BoundaryParseError(`${path}.readOnly`, "must be true");
  const expectationValue = parseExpectation(required(value, "expectation", path), `${path}.expectation`);
  const expectedExit = integerValue(required(value, "expectedExit", path), `${path}.expectedExit`);
  if (expectedExit < 0 || expectedExit > 255) throw new BoundaryParseError(`${path}.expectedExit`, "must be 0..255");
  const allowedValue = value["allowedComparisonExitCodes"];
  const allowedComparisonExitCodes = allowedValue === undefined ? [] : parseExitCodes(allowedValue, `${path}.allowedComparisonExitCodes`);
  const repeatCount = integerValue(required(value, "repeatCount", path), `${path}.repeatCount`);
  if (repeatCount !== 1 && repeatCount !== 2) throw new BoundaryParseError(`${path}.repeatCount`, "must be 1 or 2");
  return {
    id,
    category,
    command,
    cwd: "/repo",
    readOnly: true,
    expectation: expectationValue,
    expectedExit,
    allowedComparisonExitCodes,
    repeatCount,
  };
}

function parseExpectation(value: unknown, path: string): Expectation {
  const expectation = stringValue(value, path);
  switch (expectation) {
    case "exact-equal":
    case "reject-allowed":
    case "both-nonzero":
      return expectation;
    default:
      throw new BoundaryParseError(path, "unknown expectation");
  }
}

function parseExitCodes(value: unknown, path: string): readonly number[] {
  if (!Array.isArray(value)) throw new BoundaryParseError(path, "expected an array");
  return value.map((item, index) => {
    const code = integerValue(item, `${path}[${index}]`);
    if (code < 0 || code > 255) throw new BoundaryParseError(`${path}[${index}]`, "must be 0..255");
    return code;
  });
}

function isWriteBearingCommand(command: string): boolean {
  let quote: "single" | "double" | null = null;
  let token = "";
  let commandStart = true;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];
    if (character === undefined) continue;
    if (character === "\\" && quote !== "single") {
      index += 1;
      continue;
    }
    if (quote === "single") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === "double") {
      if (character === '"') quote = null;
      if (character === "`" || (character === "$" && next === "(")) return true;
      continue;
    }
    if (character === "'") {
      quote = "single";
      continue;
    }
    if (character === '"') {
      quote = "double";
      continue;
    }
    if (character === "`" || (character === "$" && next === "(")) return true;
    if (character === ">") return true;
    if (character === "|" || character === ";" || character === "&") {
      if (isForbiddenCommand(token, commandStart)) return true;
      token = "";
      commandStart = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (isForbiddenCommand(token, commandStart)) return true;
      if (token !== "") commandStart = false;
      token = "";
      continue;
    }
    token += character;
  }
  return isForbiddenCommand(token, commandStart);
}

function isForbiddenCommand(token: string, commandStart: boolean): boolean {
  if (!commandStart || token === "") return false;
  const command = token.includes("/") ? token.slice(token.lastIndexOf("/") + 1) : token;
  return command === "tee" || command === "rm" || command === "mv" || command === "dd";
}
