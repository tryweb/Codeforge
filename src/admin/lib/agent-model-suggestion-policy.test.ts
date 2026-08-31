import { describe, expect, test } from "bun:test";
import type { NormalizedModelMetadata } from "./model-metadata";
import {
  suggestForMode,
  effectiveCost,
  isContextInadequate,
  _test,
  type PolicyCapabilityCatalog,
  type PolicyInput,
} from "./agent-model-suggestion-policy";

function meta(
  ref: string,
  overrides: Partial<NormalizedModelMetadata> = {},
): NormalizedModelMetadata {
  const [providerId, modelId] = ref.split("/") as [string, string];
  return {
    providerId,
    modelId,
    reference: ref,
    inputPrice: 0,
    outputPrice: 0,
    contextLimit: 100_000,
    outputLimit: 8_192,
    reasoning: true,
    toolCall: true,
    structuredOutput: null,
    deprecated: false,
    benchmarkScore: null,
    fetchedAt: 1_000,
    ...overrides,
  };
}

function caps(refs: readonly string[]): PolicyCapabilityCatalog {
  const m = new Map<string, { reasoning?: boolean; toolcall?: boolean; attachment?: boolean; input?: Record<string, unknown> }>();
  for (const r of refs) {
    // default capable for general/exploration: toolcall true
    m.set(r, { reasoning: true, toolcall: true, attachment: false, input: {} });
  }
  return m;
}

function baseInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mode: "economy",
    providers: [],
    catalog: [],
    metadata: new Map(),
    sourceStatus: "fresh",
    sourceAgeMs: 0,
    warnings: [],
    capabilities: new Map(),
    agents: ["general"],
    ...overrides,
  };
}

describe("agent-model-suggestion-policy join", () => {
  test("intersection mismatch excludes external-only model", () => {
    const catalog = ["openai/gpt-4o", "anthropic/claude"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["openai/gpt-4o", meta("openai/gpt-4o")],
      ["openai/external-only", meta("openai/external-only")],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    // only openai/gpt-4o should be considered, external-only not in catalog => not suggested via other provider
    expect(out.suggestions.get("general")?.model).toBe("openai/gpt-4o");
  });

  test("identity mismatch requires complete provider/model identity", () => {
    // metadata key is provider/model but catalog has different provider prefix
    const catalog = ["openai/gpt-4o"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["anthropic/gpt-4o", meta("anthropic/gpt-4o")],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.has("general")).toBe(false);
  });
});

describe("free mode filtering", () => {
  const freeMeta = (ref: string, o: Partial<NormalizedModelMetadata> = {}) => meta(ref, { inputPrice: 0, outputPrice: 0, ...o });

  test("excludes paid candidate", () => {
    const catalog = ["p/free", "p/paid"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/free", freeMeta("p/free")],
      ["p/paid", freeMeta("p/paid", { inputPrice: 5, outputPrice: 10 })],
    ]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.model).toBe("p/free");
  });

  test("excludes unknown cost (null)", () => {
    const catalog = ["p/free", "p/unknown"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/free", freeMeta("p/free")],
      ["p/unknown", freeMeta("p/unknown", { inputPrice: null, outputPrice: null })],
    ]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.model).toBe("p/free");
    // Only free qualifies, unknown excluded
  });

  test("excludes stale metadata", () => {
    const catalog = ["p/free"];
    const metadata = new Map<string, NormalizedModelMetadata>([["p/free", freeMeta("p/free")]]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
      sourceStatus: "stale",
      sourceAgeMs: 5_000_000,
      warnings: ["stale_metadata"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.has("general")).toBe(false);
    expect(out.sourceStatus).toBe("stale");
  });

  test("excludes deprecated", () => {
    const catalog = ["p/free", "p/dep"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/free", freeMeta("p/free")],
      ["p/dep", freeMeta("p/dep", { deprecated: true })],
    ]);
    // Only deprecated candidate if free is also deprecated => empty
    const input = baseInput({
      mode: "free",
      catalog: ["p/dep"],
      metadata: new Map([["p/dep", freeMeta("p/dep", { deprecated: true })]]),
      capabilities: caps(["p/dep"]),
      agents: ["general"],
    });
    expect(suggestForMode(input).suggestions.has("general")).toBe(false);
  });

  test("excludes incapable (reasoning agent without reasoning)", () => {
    const catalog = ["p/free"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/free", freeMeta("p/free", { reasoning: false, toolCall: true })],
    ]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      // capabilities also influence score but minimum for free uses metadata reasoning/toolCall
      capabilities: new Map([["p/free", { reasoning: false, toolcall: true }]]),
      agents: ["plan"], // reasoning category
    });
    const out = suggestForMode(input);
    expect(out.suggestions.has("plan")).toBe(false);
  });

  test("excludes missing context for free", () => {
    const catalog = ["p/free"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/free", freeMeta("p/free", { contextLimit: null })],
    ]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    expect(suggestForMode(input).suggestions.has("general")).toBe(false);
  });

  test("no candidate yields no suggestion without fallback", () => {
    const catalog = ["p/paid"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/paid", freeMeta("p/paid", { inputPrice: 10, outputPrice: 10 })],
    ]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general", "plan"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.size).toBe(0);
  });

  test("fresh zero-price capable is eligible", () => {
    const catalog = ["p/free"];
    const metadata = new Map<string, NormalizedModelMetadata>([["p/free", freeMeta("p/free")]]);
    const input = baseInput({
      mode: "free",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.model).toBe("p/free");
    expect(out.suggestions.get("general")?.reason.length).toBeGreaterThan(0);
    expect((out.suggestions.get("general")?.reason.length ?? 0) <= 200).toBe(true);
  });
});

describe("economy ranking", () => {
  test("effective cost ordering input*0.6+output*0.4 ascending", () => {
    const catalog = ["p/cheap", "p/expensive"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/cheap", meta("p/cheap", { inputPrice: 1, outputPrice: 1 })], // 0.6+0.4=1.0
      ["p/expensive", meta("p/expensive", { inputPrice: 10, outputPrice: 10 })], // 10
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.model).toBe("p/cheap");
  });

  test("missing price ranks after known price (Infinity)", () => {
    const catalog = ["p/known", "p/unknown"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/known", meta("p/known", { inputPrice: 1, outputPrice: 1 })],
      ["p/unknown", meta("p/unknown", { inputPrice: null, outputPrice: 1 })],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    // known should win despite unknown being lexicographically earlier? check ordering
    expect(out.suggestions.get("general")?.model).toBe("p/known");
    expect(effectiveCost(meta("p/unknown", { inputPrice: null, outputPrice: 1 }))).toBe(Infinity);
  });

  test("capability score tie-breaker descending then reference ascending", () => {
    const catalog = ["p/a", "p/b"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { inputPrice: 1, outputPrice: 1 })],
      ["p/b", meta("p/b", { inputPrice: 1, outputPrice: 1 })],
    ]);
    // a has lower capability score
    const capabilities: PolicyCapabilityCatalog = new Map([
      ["p/a", { reasoning: false, toolcall: false }],
      ["p/b", { reasoning: true, toolcall: true, attachment: true, input: { a: {}, b: {} } }],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities,
      agents: ["general"],
    });
    const out = suggestForMode(input);
    // b higher score should win despite a < b lexicographically
    expect(out.suggestions.get("general")?.model).toBe("p/b");
  });

  test("reference tie-breaker when cost and capability equal", () => {
    const catalog = ["p/b", "p/a"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { inputPrice: 1, outputPrice: 1 })],
      ["p/b", meta("p/b", { inputPrice: 1, outputPrice: 1 })],
    ]);
    const capabilities = caps(catalog);
    // caps gives equal score for both
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities,
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.model).toBe("p/a");
  });

  test("missing context is inadequate", () => {
    const catalog = ["p/good", "p/bad"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/good", meta("p/good", { inputPrice: 1, outputPrice: 1, contextLimit: 1000 })],
      ["p/bad", meta("p/bad", { inputPrice: 0.1, outputPrice: 0.1, contextLimit: null })],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    // bad has cheaper cost but inadequate context, so excluded
    expect(out.suggestions.get("general")?.model).toBe("p/good");
    expect(isContextInadequate(meta("p/bad", { contextLimit: null }))).toBe(true);
    expect(isContextInadequate(meta("p/good", { contextLimit: 1 }))).toBe(false);
  });

  test("known context is adequate (any known value)", () => {
    const catalog = ["p/tiny"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/tiny", meta("p/tiny", { inputPrice: 1, outputPrice: 1, contextLimit: 1 })],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    expect(suggestForMode(input).suggestions.has("general")).toBe(true);
  });
});

describe("performance ranking", () => {
  test("benchmark descending when comparable exists", () => {
    const catalog = ["p/low", "p/high"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/low", meta("p/low", { benchmarkScore: 80, contextLimit: 1000, outputLimit: 1000 })],
      ["p/high", meta("p/high", { benchmarkScore: 95, contextLimit: 1000, outputLimit: 1000 })],
    ]);
    const input = baseInput({
      mode: "performance",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.model).toBe("p/high");
    expect(out.suggestions.get("general")?.heuristic).toBe(false);
  });

  test("heuristic true when no comparable benchmark", () => {
    const catalog = ["p/a", "p/b"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { benchmarkScore: null, contextLimit: 2000, outputLimit: 1000 })],
      ["p/b", meta("p/b", { benchmarkScore: null, contextLimit: 1000, outputLimit: 2000 })],
    ]);
    const input = baseInput({
      mode: "performance",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const out = suggestForMode(input);
    expect(out.suggestions.get("general")?.heuristic).toBe(true);
    expect(out.suggestions.get("general")?.reason.toLowerCase()).toContain("heuristic");
  });

  test("performance falls back to capability, context, output, freshness, reference", () => {
    const catalog = ["p/a", "p/b"];
    // no bench, same capability score, a has larger context
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { benchmarkScore: null, contextLimit: 2000, outputLimit: 1000, fetchedAt: 1000 })],
      ["p/b", meta("p/b", { benchmarkScore: null, contextLimit: 1000, outputLimit: 1000, fetchedAt: 1000 })],
    ]);
    const capsEqual = caps(catalog);
    const input = baseInput({
      mode: "performance",
      catalog,
      metadata,
      capabilities: capsEqual,
      agents: ["general"],
    });
    expect(suggestForMode(input).suggestions.get("general")?.model).toBe("p/a");

    // tie context, b larger output
    const metadata2 = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { benchmarkScore: null, contextLimit: 1000, outputLimit: 1000, fetchedAt: 1000 })],
      ["p/b", meta("p/b", { benchmarkScore: null, contextLimit: 1000, outputLimit: 5000, fetchedAt: 1000 })],
    ]);
    const input2 = baseInput({
      mode: "performance",
      catalog,
      metadata: metadata2,
      capabilities: capsEqual,
      agents: ["general"],
    });
    expect(suggestForMode(input2).suggestions.get("general")?.model).toBe("p/b");

    // tie context/output, fresher wins
    const metadata3 = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { benchmarkScore: null, contextLimit: 1000, outputLimit: 1000, fetchedAt: 2000 })],
      ["p/b", meta("p/b", { benchmarkScore: null, contextLimit: 1000, outputLimit: 1000, fetchedAt: 1000 })],
    ]);
    const input3 = baseInput({
      mode: "performance",
      catalog,
      metadata: metadata3,
      capabilities: capsEqual,
      agents: ["general"],
    });
    expect(suggestForMode(input3).suggestions.get("general")?.model).toBe("p/a");
  });

  test("reference tie-breaker for performance", () => {
    const catalog = ["p/b", "p/a"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { benchmarkScore: 90, contextLimit: 1000, outputLimit: 1000, fetchedAt: 1000 })],
      ["p/b", meta("p/b", { benchmarkScore: 90, contextLimit: 1000, outputLimit: 1000, fetchedAt: 1000 })],
    ]);
    const capsEqual = caps(catalog);
    const input = baseInput({
      mode: "performance",
      catalog,
      metadata,
      capabilities: capsEqual,
      agents: ["general"],
    });
    expect(suggestForMode(input).suggestions.get("general")?.model).toBe("p/a");
  });

  test("missing context excluded in performance", () => {
    const catalog = ["p/good", "p/bad"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/good", meta("p/good", { benchmarkScore: 10, contextLimit: 1000 })],
      ["p/bad", meta("p/bad", { benchmarkScore: 99, contextLimit: null })],
    ]);
    const input = baseInput({
      mode: "performance",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    expect(suggestForMode(input).suggestions.get("general")?.model).toBe("p/good");
  });
});

describe("helpers", () => {
  test("isContextInadequate only null", () => {
    expect(_test.isContextInadequate(meta("p/x", { contextLimit: null }))).toBe(true);
    expect(_test.isContextInadequate(meta("p/x", { contextLimit: 1 }))).toBe(false);
    expect(_test.isContextInadequate(meta("p/x", { contextLimit: 128000 }))).toBe(false);
  });

  test("effectiveCost Infinity when missing", () => {
    expect(_test.effectiveCost(meta("p/x", { inputPrice: null, outputPrice: 1 }))).toBe(Infinity);
    expect(_test.effectiveCost(meta("p/x", { inputPrice: 1, outputPrice: null }))).toBe(Infinity);
    expect(_test.effectiveCost(meta("p/x", { inputPrice: null, outputPrice: null }))).toBe(Infinity);
    expect(_test.effectiveCost(meta("p/x", { inputPrice: 2, outputPrice: 4 }))).toBeCloseTo(2 * 0.6 + 4 * 0.4);
  });

  test("provider scope filtering", () => {
    const catalog = ["p/a", "q/b"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { inputPrice: 1, outputPrice: 1 })],
      ["q/b", meta("q/b", { inputPrice: 0.1, outputPrice: 0.1 })],
    ]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
      providers: ["p"],
    });
    expect(suggestForMode(input).suggestions.get("general")?.model).toBe("p/a");
  });

  test("bounded reason length", () => {
    const catalog = ["p/a"];
    const metadata = new Map<string, NormalizedModelMetadata>([["p/a", meta("p/a")]]);
    const input = baseInput({
      mode: "performance",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
    });
    const reason = suggestForMode(input).suggestions.get("general")?.reason ?? "";
    expect(reason.length <= 200).toBe(true);
  });

  test("warning handling passthrough", () => {
    const catalog = ["p/a"];
    const metadata = new Map<string, NormalizedModelMetadata>([["p/a", meta("p/a")]]);
    const input = baseInput({
      mode: "economy",
      catalog,
      metadata,
      capabilities: caps(catalog),
      agents: ["general"],
      warnings: ["incomplete_metadata", "stale_metadata"],
      sourceStatus: "stale",
      sourceAgeMs: 1000,
    });
    const out = suggestForMode(input);
    expect(out.warnings).toEqual(["incomplete_metadata", "stale_metadata"]);
    expect(out.sourceStatus).toBe("stale");
  });

  test("uses codepoint order for equal-score references", () => {
    const catalog = ["p/a", "p/Z"];
    const metadata = new Map<string, NormalizedModelMetadata>([
      ["p/a", meta("p/a", { inputPrice: 1, outputPrice: 1 })],
      ["p/Z", meta("p/Z", { inputPrice: 1, outputPrice: 1 })],
    ]);
    const input = baseInput({ mode: "economy", catalog, metadata, capabilities: caps(catalog), agents: ["general"] });
    expect(suggestForMode(input).suggestions.get("general")?.model).toBe("p/Z");
  });
});
