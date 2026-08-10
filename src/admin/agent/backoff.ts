/** Create a capped exponential backoff with jitter and reset support. */
export function createBackoff(): { nextDelayMs: () => number; reset: () => void } {
  const initialDelayMs = 1_000;
  const maximumDelayMs = 300_000;
  let baseDelayMs = initialDelayMs;

  return {
    nextDelayMs: (): number => {
      const jitteredDelayMs = Math.round(baseDelayMs * (0.75 + Math.random() * 0.5));
      baseDelayMs = Math.min(baseDelayMs * 2, maximumDelayMs);
      return Math.min(jitteredDelayMs, maximumDelayMs);
    },
    reset: (): void => {
      baseDelayMs = initialDelayMs;
    },
  };
}
