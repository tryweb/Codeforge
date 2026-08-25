import { describe, expect, test } from "bun:test";
import { captureCommand, makeCapture } from "./capture";

describe("live capture adapter", () => {
  test("captures independent streams, bytes, hashes, and expected nonzero exits", async () => {
    const capture = await captureCommand({ command: "printf 'out\\n'; printf 'err\\n' >&2; exit 2", timeoutMs: 1_000 });
    expect(capture.stdout).toBe("out\n");
    expect(capture.stderr).toBe("err\n");
    expect(capture.exitCode).toBe(2);
    expect(capture.stdoutBytes).toBe(4);
    expect(capture.stderrBytes).toBe(4);
    expect(capture.timedOut).toBe(false);
  });

  test("marks timeout and preserves a bounded exit contract", async () => {
    const started = performance.now();
    const capture = await captureCommand({ command: "sleep 1", timeoutMs: 20 });
    const elapsedMs = performance.now() - started;
    expect(capture.timedOut).toBe(true);
    expect(capture.exitCode).toBe(124);
    expect(elapsedMs).toBeLessThan(250);
  });

  test("kills descendant processes and closes pipes at the timeout boundary", async () => {
    const started = performance.now();
    const capture = await captureCommand({ command: "(sleep 1)&", timeoutMs: 20 });
    const elapsedMs = performance.now() - started;
    expect(capture.timedOut).toBe(true);
    expect(capture.exitCode).toBe(124);
    expect(elapsedMs).toBeLessThan(250);
  });

  test("detects markers and appended content relative to direct output", () => {
    const expected = makeCapture("stable\n", "", 0, 1, false);
    const observed = makeCapture("stable\n[lean-ctx: filtered]\n", "", 0, 1, false, expected);
    expect(observed.markerDetected).toBe(true);
    expect(observed.appendedContentDetected).toBe(true);
  });
});
