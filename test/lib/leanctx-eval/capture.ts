import { createHash } from "node:crypto";
import type { Capture } from "./types";

export type CaptureMode = "direct" | "leanctx";

export type CaptureOptions = {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly mode?: CaptureMode;
  readonly expected?: Capture;
};

export type CapturePair = {
  readonly direct: Capture;
  readonly leanctx: Capture;
};

const MARKER = "[lean-ctx:";
const DEFAULT_TIMEOUT_MS = 10_000;

export async function captureCommand(options: CaptureOptions): Promise<Capture> {
  const started = performance.now();
  const mode = options.mode ?? "direct";
  const executable = mode === "direct" ? options.command : `lean-ctx -c ${shellQuote(options.command)}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutDuration = `${Math.floor(timeoutMs / 1000)}.${String(timeoutMs % 1000).padStart(3, "0")}s`;
  const waitedExecutable = `${executable}\ncommand_status=$?\nwait\nexit "$command_status"`;
  const process = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=0.100s", timeoutDuration, "sh", "-lc", waitedExecutable], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const outputPromise = Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
  const exitCode = await process.exited;
  const [stdout, stderr] = await outputPromise;
  const timedOut = exitCode === 124;
  const capture = makeCapture(stdout, stderr, timedOut ? 124 : exitCode, Math.round(performance.now() - started), timedOut, options.expected);
  return capture;
}

export async function capturePair(command: string, options: Omit<CaptureOptions, "command" | "mode" | "expected"> = {}): Promise<CapturePair> {
  const direct = await captureCommand({ ...options, command, mode: "direct" });
  const leanctx = await captureCommand({ ...options, command, mode: "leanctx", expected: direct });
  return { direct, leanctx };
}

export function makeCapture(stdout: string, stderr: string, exitCode: number, durationMs: number, timedOut: boolean, expected?: Capture): Capture {
  return {
    stdout,
    stderr,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    exitCode,
    durationMs,
    timedOut,
    markerDetected: stdout.includes(MARKER) || stderr.includes(MARKER),
    appendedContentDetected: expected !== undefined && (isAppended(expected.stdout ?? "", stdout) || isAppended(expected.stderr ?? "", stderr)),
  };
}

function isAppended(expected: string, observed: string): boolean {
  return expected.length > 0 && observed.startsWith(expected) && observed.length > expected.length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
