import { describe, expect, it } from "bun:test";
import { createBackoff } from "./backoff";

describe("createBackoff", () => {
  it("returns exponentially increasing delays within the jitter range", () => {
    const backoff = createBackoff();
    const baseDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000];

    const delays = baseDelays.map(() => backoff.nextDelayMs());

    for (const [index, delay] of delays.entries()) {
      const base = baseDelays[index];
      expect(base).toBeDefined();
      if (base === undefined) continue;
      expect(delay).toBeGreaterThanOrEqual(Math.round(base * 0.75));
      expect(delay).toBeLessThanOrEqual(Math.round(base * 1.25));
    }
  });

  it("never returns a delay above five minutes", () => {
    const backoff = createBackoff();

    const delays = Array.from({ length: 20 }, () => backoff.nextDelayMs());

    expect(Math.max(...delays)).toBeLessThanOrEqual(300_000);
  });

  it("resets to the first delay range", () => {
    const backoff = createBackoff();
    backoff.nextDelayMs();
    backoff.nextDelayMs();
    backoff.nextDelayMs();

    backoff.reset();
    const delay = backoff.nextDelayMs();

    expect(delay).toBeGreaterThanOrEqual(750);
    expect(delay).toBeLessThanOrEqual(1_250);
  });
});
