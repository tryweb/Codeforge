import { readFile } from "node:fs/promises";
import { evaluate } from "./evaluate";
import { BoundaryParseError, canonicalJson, hasOnlyKeys, hashCanonical, isRecord } from "./boundary";
import { parseManifestJson } from "./parse-manifest";
import { parseRecordsJson } from "./parse-records";
import { renderMarkdown, renderVerdictJson } from "./render";
import { parseJson } from "./boundary";
import { parseCapturedDriftInput, runReliabilityGates } from "./gate-checker";

export type CliIo = {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

const REAL_IO: CliIo = {
  readFile: (path) => readFile(path, "utf8"),
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
};

export async function runCli(argv: readonly string[], io: CliIo = REAL_IO): Promise<number> {
  try {
    const command = argv[0];
    switch (command) {
      case "validate-manifest":
        return await validateManifest(argv.slice(1), io);
      case "evaluate":
        return await evaluateCommand(argv.slice(1), io, false);
      case "render":
        return await evaluateCommand(argv.slice(1), io, true);
      case "selfcheck":
        return await evaluateCommand(argv.slice(1), io, false);
      case "check-gates":
      case "check-drift":
        return await gateCommand(argv.slice(1), io);
      default:
        throw new BoundaryParseError("cli", "usage: validate-manifest, evaluate, render, selfcheck, or check-gates");
    }
  } catch (error: unknown) {
    if (error instanceof Error) io.writeStderr(`${error.message}\n`);
    else io.writeStderr("unknown CLI error\n");
    return 1;
  }
}

async function gateCommand(args: readonly string[], io: CliIo): Promise<number> {
  const path = args[0];
  if (path === undefined) throw new BoundaryParseError("cli", "check-gates requires a captured JSON path");
  const parsed = parseJson(await io.readFile(path), path);
  const inputs = Array.isArray(parsed) ? parsed : isRecord(parsed) && (hasOnlyKeys(parsed, ["inputs"], path), Array.isArray(parsed["inputs"])) ? parsed["inputs"] : null;
  if (inputs === null) throw new BoundaryParseError(path, "expected an array or an object with inputs");
  const result = runReliabilityGates(inputs.map((item, index) => parseCapturedDriftInput(item, `${path}.inputs[${index}]`)));
  io.writeStdout(`${JSON.stringify(result)}\n`);
  return result.g0.passed && result.g1.passed ? 0 : 1;
}

async function validateManifest(args: readonly string[], io: CliIo): Promise<number> {
  const path = args[0];
  if (path === undefined) throw new BoundaryParseError("cli", "validate-manifest requires a path");
  const manifest = parseManifestJson(await io.readFile(path));
  io.writeStdout(canonicalJson({ manifestHash: hashCanonical(manifest), scenarioCount: manifest.scenarios.length, valid: true }));
  return 0;
}

async function evaluateCommand(args: readonly string[], io: CliIo, markdown: boolean): Promise<number> {
  const manifestPath = option(args, "--manifest");
  const recordsPath = option(args, "--records");
  if (manifestPath === undefined || recordsPath === undefined) throw new BoundaryParseError("cli", "--manifest and --records are required");
  const manifest = parseManifestJson(await io.readFile(manifestPath));
  const records = parseRecordsJson(await io.readFile(recordsPath), manifest);
  const result = evaluate(manifest, records);
  io.writeStdout(markdown ? renderMarkdown(result) : renderVerdictJson(result));
  return 0;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
