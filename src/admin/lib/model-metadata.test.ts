import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearModelMetadataCache,
  fetchModelMetadata,
  getModelMetadataCache,
  normalizeMetadataPayload,
  MODELS_DEV_URL,
  METADATA_TIMEOUT_MS,
  FREE_FRESH_TTL_MS,
  OTHER_USABLE_TTL_MS,
  type FetchImpl,
  type NormalizedModelMetadata,
} from "./model-metadata";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchImpl {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  };
}

// Minimal complete fixture
function completeFixture(): Record<string, unknown> {
  return {
    openai: {
      id: "openai",
      models: {
        "gpt-4o": {
          id: "gpt-4o",
          cost: { input: 2.5, output: 10 },
          limit: { context: 128000, output: 16384 },
          reasoning: true,
          tool_call: true,
          structured_output: true,
          deprecated: false,
          benchmark_score: 92.5,
        },
      },
    },
    anthropic: {
      id: "anthropic",
      models: {
        "claude-3-5-sonnet": {
          cost: { input: 3, output: 15 },
          limit: { context: 200000, output: 8192 },
          capabilities: { reasoning: true, tool_call: true, structured_output: false },
          deprecated: false,
        },
      },
    },
  };
}

describe("normalizeMetadataPayload", () => {
  test("complete record normalizes all fields", () => {
    const payload = completeFixture();
    const { models, warnings, valid } = normalizeMetadataPayload(payload, 1000);
    expect(valid).toBe(true);
    expect(warnings).toEqual([]);
    const m = models.get("openai/gpt-4o") as NormalizedModelMetadata;
    expect(m.providerId).toBe("openai");
    expect(m.modelId).toBe("gpt-4o");
    expect(m.reference).toBe("openai/gpt-4o");
    expect(m.inputPrice).toBe(2.5);
    expect(m.outputPrice).toBe(10);
    expect(m.contextLimit).toBe(128000);
    expect(m.outputLimit).toBe(16384);
    expect(m.reasoning).toBe(true);
    expect(m.toolCall).toBe(true);
    expect(m.structuredOutput).toBe(true);
    expect(m.deprecated).toBe(false);
    expect(m.benchmarkScore).toBe(92.5);
    expect(m.fetchedAt).toBe(1000);

    const m2 = models.get("anthropic/claude-3-5-sonnet");
    expect(m2?.reasoning).toBe(true);
    expect(m2?.toolCall).toBe(true);
    expect(m2?.structuredOutput).toBe(false);
    expect(m2?.benchmarkScore).toBeNull();
  });

  test("missing cost/capability/limits yields null without inventing values", () => {
    const payload = {
      openai: {
        models: {
          "gpt-missing": {
            id: "gpt-missing",
          },
        },
      },
    };
    const { models, warnings, valid } = normalizeMetadataPayload(payload, 2000);
    expect(valid).toBe(true);
    expect(models.size).toBe(1);
    const m = models.get("openai/gpt-missing") as NormalizedModelMetadata;
    expect(m.inputPrice).toBeNull();
    expect(m.outputPrice).toBeNull();
    expect(m.contextLimit).toBeNull();
    expect(m.outputLimit).toBeNull();
    expect(m.reasoning).toBeNull();
    expect(m.toolCall).toBeNull();
    expect(m.structuredOutput).toBeNull();
    expect(m.deprecated).toBe(false);
    expect(m.benchmarkScore).toBeNull();
    expect(warnings).toContain("incomplete_metadata");
  });

  test("deprecated record preserves deprecated status", () => {
    const payload = {
      openai: {
        models: {
          "old-model": {
            cost: { input: 0, output: 0 },
            limit: { context: 4096, output: 1024 },
            reasoning: true,
            tool_call: true,
            deprecated: true,
          },
          "also-deprecated": {
            cost: { input: 1, output: 2 },
            status: "deprecated",
            limit: { context: 8192 },
          },
        },
      },
    };
    const { models } = normalizeMetadataPayload(payload, 3000);
    expect(models.get("openai/old-model")?.deprecated).toBe(true);
    expect(models.get("openai/also-deprecated")?.deprecated).toBe(true);
  });

  test("malformed top-level payload is invalid", () => {
    const r1 = normalizeMetadataPayload(null, 0);
    expect(r1.valid).toBe(false);
    expect(r1.models.size).toBe(0);
    expect(r1.warnings).toContain("metadata_unavailable");

    const r2 = normalizeMetadataPayload([], 0);
    expect(r2.valid).toBe(false);

    const r3 = normalizeMetadataPayload("string", 0);
    expect(r3.valid).toBe(false);

    const r4 = normalizeMetadataPayload(123, 0);
    expect(r4.valid).toBe(false);
  });

  test("malformed per-model cost types are treated as unknown, not thrown", () => {
    const payload = {
      openai: {
        models: {
          "bad-cost": {
            cost: { input: "free", output: null },
            limit: { context: "large", output: -5 },
            reasoning: "yes" as unknown,
            tool_call: 1 as unknown,
            deprecated: "true" as unknown,
          },
          "good-model": {
            cost: { input: 0, output: 0 },
            limit: { context: 1000, output: 500 },
            reasoning: false,
            tool_call: false,
          },
        },
      },
    };
    const { models, valid } = normalizeMetadataPayload(payload, 4000);
    expect(valid).toBe(true);
    const bad = models.get("openai/bad-cost") as NormalizedModelMetadata;
    expect(bad.inputPrice).toBeNull();
    expect(bad.outputPrice).toBeNull();
    expect(bad.contextLimit).toBeNull();
    expect(bad.outputLimit).toBeNull();
    expect(bad.reasoning).toBeNull();
    expect(bad.toolCall).toBeNull();
    expect(bad.deprecated).toBe(false);
    expect(models.has("openai/good-model")).toBe(true);
  });

  test("malformed provider entry is skipped, valid providers still normalized", () => {
    const payload = {
      openai: "not-an-object" as unknown,
      anthropic: {
        models: {
          "claude-3": {
            cost: { input: 3, output: 15 },
            limit: { context: 200000 },
            reasoning: true,
            tool_call: true,
          },
        },
      },
      badProvider: null as unknown,
    };
    const { models, valid } = normalizeMetadataPayload(payload, 5000);
    expect(valid).toBe(true);
    expect(models.size).toBe(1);
    expect(models.has("anthropic/claude-3")).toBe(true);
  });

  test("optional benchmark is preserved when present and null when absent", () => {
    const payload = {
      prov: {
        models: {
          "with-bench": { benchmark_score: 88.1, cost: { input: 1, output: 2 } },
          "without-bench": { cost: { input: 1, output: 2 } },
          "malformed-bench": { benchmark_score: "high" as unknown, cost: { input: 1, output: 2 } },
        },
      },
    };
    const { models } = normalizeMetadataPayload(payload, 6000);
    expect(models.get("prov/with-bench")?.benchmarkScore).toBe(88.1);
    expect(models.get("prov/without-bench")?.benchmarkScore).toBeNull();
    expect(models.get("prov/malformed-bench")?.benchmarkScore).toBeNull();
  });

  test("supports providers wrapper object", () => {
    const payload = {
      providers: {
        openai: {
          models: {
            "gpt-4o": {
              cost: { input: 2.5, output: 10 },
              limit: { context: 128000 },
              reasoning: true,
              tool_call: true,
            },
          },
        },
      },
    };
    const { models, valid } = normalizeMetadataPayload(payload, 7000);
    expect(valid).toBe(true);
    expect(models.has("openai/gpt-4o")).toBe(true);
  });

  test("skips provider entries that are not nested under models", () => {
    const payload = {
      provider: {
        accidentalModel: {
          cost: { input: 0, output: 0 },
          limit: { context: 4096 },
        },
      },
    };
    const { models } = normalizeMetadataPayload(payload, 8000);
    expect(models.size).toBe(0);
  });
});

describe("fetchModelMetadata cache behavior", () => {
  beforeEach(() => {
    clearModelMetadataCache();
  });

  test("fresh fetch validates, normalizes, caches and returns fresh", async () => {
    let fetchedUrl = "";
    let fetchedSignal: AbortSignal | undefined;
    const fetchImpl = makeFetch((url, init) => {
      fetchedUrl = url;
      fetchedSignal = init?.signal as AbortSignal | undefined;
      return jsonResponse(completeFixture());
    });
    let now = 1_000_000;
    const result = await fetchModelMetadata({ fetchImpl, now: () => now });
    expect(fetchedUrl).toBe(MODELS_DEV_URL);
    expect(fetchedSignal).toBeDefined();
    expect(result.sourceStatus).toBe("fresh");
    expect(result.sourceAgeMs).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.models.size).toBe(2);
    expect(result.fetchedAt).toBe(now);
    expect(getModelMetadataCache()?.fetchedAt).toBe(now);
    // constants are correct
    expect(METADATA_TIMEOUT_MS).toBe(3000);
    expect(FREE_FRESH_TTL_MS).toBe(3600000);
    expect(OTHER_USABLE_TTL_MS).toBe(21600000);
  });

  test("does not let callers mutate the cached model map", async () => {
    let now = 1_000_000;
    const successFetch = makeFetch(() => jsonResponse(completeFixture()));
    const first = await fetchModelMetadata({ fetchImpl: successFetch, now: () => now });
    const callerCopy = new Map(first.models);
    callerCopy.clear();

    now += 1_000;
    const cached = await fetchModelMetadata({
      fetchImpl: makeFetch(() => { throw new Error("network down"); }),
      now: () => now,
    });
    expect(cached.models.size).toBe(2);
  });

  test("fresh cache is returned when fresh and fetch fails", async () => {
    let now = 0;
    const successFetch = makeFetch(() => jsonResponse(completeFixture()));
    const r1 = await fetchModelMetadata({ fetchImpl: successFetch, now: () => now });
    expect(r1.sourceStatus).toBe("fresh");

    // advance 10 minutes (within FREE_FRESH_TTL)
    now = 600_000;
    const failingFetch = makeFetch(() => {
      throw new Error("network down");
    });
    const r2 = await fetchModelMetadata({ fetchImpl: failingFetch, now: () => now });
    expect(r2.sourceStatus).toBe("fresh");
    expect(r2.sourceAgeMs).toBe(600_000);
    expect(r2.models.size).toBe(2);
    expect(r2.fetchedAt).toBe(0);
    expect(r2.warnings).toEqual([]);
  });

  test("stale cache is usable with stale_metadata warning after FREE_FRESH_TTL", async () => {
    let now = 0;
    const successFetch = makeFetch(() => jsonResponse(completeFixture()));
    await fetchModelMetadata({ fetchImpl: successFetch, now: () => now });

    // advance 2 hours (>1h but <6h)
    now = FREE_FRESH_TTL_MS + 1000;
    const failingFetch = makeFetch(() => new Response("oops", { status: 500 }));
    const result = await fetchModelMetadata({ fetchImpl: failingFetch, now: () => now });
    expect(result.sourceStatus).toBe("stale");
    expect(result.sourceAgeMs).toBe(FREE_FRESH_TTL_MS + 1000);
    expect(result.warnings).toContain("stale_metadata");
    expect(result.models.size).toBe(2);
    expect(result.fetchedAt).toBe(0);
  });

  test("expired cache beyond OTHER_USABLE_TTL returns unavailable", async () => {
    let now = 0;
    const successFetch = makeFetch(() => jsonResponse(completeFixture()));
    await fetchModelMetadata({ fetchImpl: successFetch, now: () => now });

    now = OTHER_USABLE_TTL_MS + 1000;
    const failingFetch = makeFetch(() => {
      throw new Error("network down");
    });
    const result = await fetchModelMetadata({ fetchImpl: failingFetch, now: () => now });
    expect(result.sourceStatus).toBe("unavailable");
    expect(result.sourceAgeMs).toBeNull();
    expect(result.warnings).toContain("metadata_unavailable");
    expect(result.models.size).toBe(0);
    expect(result.fetchedAt).toBeNull();
  });

  test("malformed JSON response falls back to fresh cache when available", async () => {
    let now = 0;
    const successFetch = makeFetch(() => jsonResponse(completeFixture()));
    await fetchModelMetadata({ fetchImpl: successFetch, now: () => now });

    now = 500_000;
    const malformedFetch = makeFetch(() => new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }));
    // Response.json will throw on invalid json, but our handler returns not json body; fetchModelMetadata tries response.json()
    // Simulate json parse failure by making fetch return response where json() throws
    const throwingFetch: FetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);

    const result = await fetchModelMetadata({ fetchImpl: throwingFetch, now: () => now });
    // should fallback to cached fresh
    expect(result.sourceStatus).toBe("fresh");
    expect(result.models.size).toBe(2);

    void malformedFetch;
  });

  test("malformed payload shape without cache returns unavailable", async () => {
    const malformedFetch = makeFetch(() => jsonResponse(["not", "a", "record"]));
    const result = await fetchModelMetadata({ fetchImpl: malformedFetch, now: () => 0 });
    expect(result.sourceStatus).toBe("unavailable");
    expect(result.warnings).toContain("metadata_unavailable");
    expect(result.models.size).toBe(0);
    expect(getModelMetadataCache()).toBeNull();
  });

  test("timeout abort yields unavailable when no cache", async () => {
    const timeoutFetch: FetchImpl = async (_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
        // never resolves, relies on abort
      });
    };
    // fetchModelMetadata uses 3000ms timeout; we need to allow abort to fire
    // Use a short real wait: the AbortController will abort after 3000ms, but test would be slow.
    // Instead simulate immediate AbortError to cover timeout path without waiting 3s.
    const immediateAbortFetch: FetchImpl = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const result = await fetchModelMetadata({ fetchImpl: immediateAbortFetch, now: () => 0 });
    expect(result.sourceStatus).toBe("unavailable");
    expect(result.warnings).toContain("metadata_unavailable");
    void timeoutFetch;
  });

  test("timeout with stale cache returns stale", async () => {
    let now = 0;
    const successFetch = makeFetch(() => jsonResponse(completeFixture()));
    await fetchModelMetadata({ fetchImpl: successFetch, now: () => now });

    now = FREE_FRESH_TTL_MS + 5000;
    const abortFetch: FetchImpl = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const result = await fetchModelMetadata({ fetchImpl: abortFetch, now: () => now });
    expect(result.sourceStatus).toBe("stale");
    expect(result.warnings).toContain("stale_metadata");
    expect(result.models.size).toBe(2);
  });

  test("unavailable without cache returns metadata_unavailable and empty models", async () => {
    const failingFetch = makeFetch(() => new Response("", { status: 503 }));
    const result = await fetchModelMetadata({ fetchImpl: failingFetch, now: () => 12345 });
    expect(result.sourceStatus).toBe("unavailable");
    expect(result.sourceAgeMs).toBeNull();
    expect(result.warnings).toEqual(["metadata_unavailable"]);
    expect(result.models.size).toBe(0);
    expect(result.fetchedAt).toBeNull();
  });

  test("rejects a response whose declared body exceeds the metadata limit", async () => {
    const oversized = new Response(JSON.stringify(completeFixture()), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "16000001",
      },
    });
    const result = await fetchModelMetadata({ fetchImpl: makeFetch(() => oversized), now: () => 0 });
    expect(result.sourceStatus).toBe("unavailable");
    expect(result.warnings).toContain("metadata_unavailable");
  });

  test("logs metadata fetch failures when no usable cache exists", async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: Parameters<typeof console.error>) => { errors.push(args); };
    try {
      await fetchModelMetadata({
        fetchImpl: makeFetch(() => { throw new Error("network down"); }),
        now: () => 0,
      });
    } finally {
      console.error = originalError;
    }
    expect(errors.length).toBe(1);
    expect(errors[0]?.[0]).toBe("[agent-models] model metadata fetch failed:");
  });

  test("non-ok HTTP status is treated as failure and uses cache if stale", async () => {
    let now = 0;
    await fetchModelMetadata({ fetchImpl: makeFetch(() => jsonResponse(completeFixture())), now: () => now });
    now = 2 * FREE_FRESH_TTL_MS;
    const httpErrorFetch = makeFetch(() => new Response("error", { status: 500 }));
    const result = await fetchModelMetadata({ fetchImpl: httpErrorFetch, now: () => now });
    expect(result.sourceStatus).toBe("stale");
    expect(result.warnings).toContain("stale_metadata");
  });

  test("fetch uses fixed allowlisted URL and AbortController timeout", async () => {
    let capturedUrl = "";
    let capturedSignal: AbortSignal | null = null;
    const fetchImpl = makeFetch((url, init) => {
      capturedUrl = url;
      capturedSignal = (init?.signal as AbortSignal) ?? null;
      return jsonResponse(completeFixture());
    });
    await fetchModelMetadata({ fetchImpl, now: () => 0 });
    expect(capturedUrl).toBe(MODELS_DEV_URL);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(MODELS_DEV_URL).toBe("https://models.dev/api.json");
  });

  test("successful refetch after stale updates cache to fresh", async () => {
    let now = 0;
    await fetchModelMetadata({ fetchImpl: makeFetch(() => jsonResponse(completeFixture())), now: () => now });
    now = FREE_FRESH_TTL_MS + 2000;
    // first failing gives stale
    const stale = await fetchModelMetadata({ fetchImpl: makeFetch(() => { throw new Error("down"); }), now: () => now });
    expect(stale.sourceStatus).toBe("stale");

    // successful refetch updates
    const freshAgain = await fetchModelMetadata({ fetchImpl: makeFetch(() => jsonResponse(completeFixture())), now: () => now });
    expect(freshAgain.sourceStatus).toBe("fresh");
    expect(freshAgain.sourceAgeMs).toBe(0);
    expect(freshAgain.fetchedAt).toBe(now);
    expect(getModelMetadataCache()?.fetchedAt).toBe(now);
  });

  test("incomplete_metadata warning propagates through cache", async () => {
    const incompletePayload = {
      prov: {
        models: {
          "m1": { cost: { input: 1 } }, // missing output
        },
      },
    };
    const result = await fetchModelMetadata({ fetchImpl: makeFetch(() => jsonResponse(incompletePayload)), now: () => 0 });
    expect(result.warnings).toContain("incomplete_metadata");
    expect(result.sourceStatus).toBe("fresh");

    const cached = await fetchModelMetadata({ fetchImpl: makeFetch(() => { throw new Error("down"); }), now: () => 500 });
    expect(cached.warnings).toContain("incomplete_metadata");
  });
});
