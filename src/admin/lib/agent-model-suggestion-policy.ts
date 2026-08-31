import type { NormalizedModelMetadata, SourceStatus, WarningCode } from "./model-metadata";

// Reuse existing reconciler capability semantics (no duplicate incompatible rules).
export type SuggestionMode = "free" | "economy" | "performance";

export type PolicyCapability = {
  readonly reasoning?: boolean;
  readonly toolcall?: boolean;
  readonly attachment?: boolean;
  readonly input?: Record<string, unknown>;
};
export type PolicyCapabilityCatalog = ReadonlyMap<string, PolicyCapability>;

export type PolicyCandidate = {
  readonly reference: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly metadata: NormalizedModelMetadata;
  readonly capability: PolicyCapability | undefined;
  readonly capabilityScore: number;
  readonly effectiveCost: number;
};

export type SuggestionMetadata = {
  readonly inputPrice: number | null;
  readonly outputPrice: number | null;
  readonly contextLimit: number | null;
  readonly outputLimit: number | null;
  readonly reasoning: boolean | null;
  readonly toolCall: boolean | null;
  readonly structuredOutput: boolean | null;
  readonly deprecated: boolean;
};

export type AgentSuggestion = {
  readonly model: string;
  readonly metadata: SuggestionMetadata;
  readonly reason: string;
  readonly heuristic: boolean;
};

export type PolicyInput = {
  readonly mode: SuggestionMode;
  readonly providers: readonly string[];
  readonly catalog: readonly string[];
  readonly metadata: ReadonlyMap<string, NormalizedModelMetadata>;
  readonly sourceStatus: SourceStatus;
  readonly sourceAgeMs: number | null;
  readonly warnings: readonly WarningCode[];
  readonly capabilities: PolicyCapabilityCatalog;
  readonly agents: readonly string[];
};

export type PolicyOutput = {
  readonly mode: SuggestionMode;
  readonly providers: readonly string[];
  readonly sourceStatus: SourceStatus;
  readonly sourceAgeMs: number | null;
  readonly warnings: readonly WarningCode[];
  readonly suggestions: ReadonlyMap<string, AgentSuggestion>;
};

const REASON_MAX = 200;

function capReason(s: string): string {
  return s.length <= REASON_MAX ? s : `${s.slice(0, REASON_MAX - 1)}…`;
}

export function category(agent: string): "reasoning" | "exploration" | "general" {
  if (["plan", "oracle", "metis", "momus"].includes(agent)) return "reasoning";
  if (["explore", "librarian"].includes(agent)) return "exploration";
  return "general";
}

export function capabilityScore(agent: string, capability: PolicyCapability | undefined): number {
  if (capability === undefined) return 0;
  const inputCount = capability.input === undefined ? 0 : Object.keys(capability.input).length;
  switch (category(agent)) {
    case "reasoning":
      return (capability.reasoning === true ? 100 : 0) + (capability.toolcall === true ? 20 : 0) + inputCount;
    case "exploration":
      return (capability.toolcall === true ? 100 : 0) + (capability.reasoning === false ? 20 : 0) + (capability.attachment === true ? 10 : 0);
    case "general":
      return (capability.toolcall === true ? 100 : 0) + (capability.attachment === true ? 20 : 0) + (capability.reasoning === true ? 10 : 0);
    default:
      return 0;
  }
}

export function compareReferences(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function effectiveCost(m: NormalizedModelMetadata): number {
  if (m.inputPrice === null || m.outputPrice === null) return Infinity;
  return m.inputPrice * 0.6 + m.outputPrice * 0.4;
}

export function isContextInadequate(m: NormalizedModelMetadata): boolean {
  return m.contextLimit === null;
}

function hasMinimumCapabilities(agent: string, m: NormalizedModelMetadata): boolean {
  const cat = category(agent);
  if (cat === "reasoning") return m.reasoning === true;
  // exploration and general require toolCall true (minimum tool-use)
  return m.toolCall === true;
}

function hasMinimumForFree(agent: string, m: NormalizedModelMetadata): boolean {
  // Free requires same minimum plus non-deprecated and zero cost already checked
  return hasMinimumCapabilities(agent, m);
}

function toSuggestionMetadata(m: NormalizedModelMetadata): SuggestionMetadata {
  return {
    inputPrice: m.inputPrice,
    outputPrice: m.outputPrice,
    contextLimit: m.contextLimit,
    outputLimit: m.outputLimit,
    reasoning: m.reasoning,
    toolCall: m.toolCall,
    structuredOutput: m.structuredOutput,
    deprecated: m.deprecated,
  };
}

function joinCandidates(
  catalog: readonly string[],
  metadata: ReadonlyMap<string, NormalizedModelMetadata>,
  providers: readonly string[],
  capabilities: PolicyCapabilityCatalog,
): PolicyCandidate[] {
  const providerSet = providers.length === 0 ? null : new Set(providers);
  const seen = new Set<string>();
  const candidates: PolicyCandidate[] = [];
  for (const ref of catalog) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    // provider scope filter
    const slash = ref.indexOf("/");
    if (slash === -1) continue;
    const providerId = ref.slice(0, slash);
    if (providerSet !== null && !providerSet.has(providerId)) continue;
    const meta = metadata.get(ref);
    if (meta === undefined) continue;
    // identity match already via ref; providerId/modelId consistency check
    if (meta.reference !== ref) continue;
    // Unmatched/deprecated handled in ranking filters, but keep here only joined
    const cap = capabilities.get(ref);
    // Use any agent placeholder for score? Score is per-agent, compute later per agent ranking, but store base?
    // Effective cost is mode-agnostic
    candidates.push({
      reference: ref,
      providerId,
      modelId: ref.slice(slash + 1),
      metadata: meta,
      capability: cap,
      capabilityScore: 0, // placeholder, computed per-agent
      effectiveCost: effectiveCost(meta),
    });
  }
  return candidates;
}

function filterFree(
  agent: string,
  candidates: readonly PolicyCandidate[],
  sourceStatus: SourceStatus,
): PolicyCandidate[] {
  if (sourceStatus !== "fresh") return [];
  return candidates.filter((c) => {
    if (c.metadata.deprecated) return false;
    if (c.metadata.inputPrice !== 0 || c.metadata.outputPrice !== 0) return false;
    if (c.metadata.inputPrice === null || c.metadata.outputPrice === null) return false;
    if (isContextInadequate(c.metadata)) return false;
    if (!hasMinimumForFree(agent, c.metadata)) return false;
    return true;
  });
}

function filterEconomyPerformance(
  agent: string,
  candidates: readonly PolicyCandidate[],
): PolicyCandidate[] {
  return candidates.filter((c) => {
    if (c.metadata.deprecated) return false;
    if (isContextInadequate(c.metadata)) return false;
    if (!hasMinimumCapabilities(agent, c.metadata)) return false;
    return true;
  });
}

function sortEconomy(agent: string, candidates: PolicyCandidate[]): PolicyCandidate[] {
  const withScore = candidates.map((c) => ({
    ...c,
    capabilityScore: capabilityScore(agent, c.capability),
  }));
  withScore.sort((a, b) => {
    if (a.effectiveCost !== b.effectiveCost) {
      // Infinity correctly sorts last via numeric compare
      if (!Number.isFinite(a.effectiveCost) && !Number.isFinite(b.effectiveCost)) {
        // both Infinity -> tie break via next
      } else if (!Number.isFinite(a.effectiveCost)) return 1;
      else if (!Number.isFinite(b.effectiveCost)) return -1;
      else return a.effectiveCost - b.effectiveCost;
    }
    if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
    return compareReferences(a.reference, b.reference);
  });
  return withScore;
}

function sortPerformance(agent: string, candidates: PolicyCandidate[]): { sorted: PolicyCandidate[]; heuristic: boolean } {
  const hasComparable = candidates.some((c) => c.metadata.benchmarkScore !== null);
  const withScore = candidates.map((c) => ({
    ...c,
    capabilityScore: capabilityScore(agent, c.capability),
  }));
  withScore.sort((a, b) => {
    const aBench = a.metadata.benchmarkScore;
    const bBench = b.metadata.benchmarkScore;
    if (hasComparable) {
      const aVal = aBench ?? Number.NEGATIVE_INFINITY;
      const bVal = bBench ?? Number.NEGATIVE_INFINITY;
      if (aVal !== bVal) return bVal - aVal;
    }
    if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
    const aCtx = a.metadata.contextLimit ?? Number.NEGATIVE_INFINITY;
    const bCtx = b.metadata.contextLimit ?? Number.NEGATIVE_INFINITY;
    if (aCtx !== bCtx) return bCtx - aCtx;
    const aOut = a.metadata.outputLimit ?? Number.NEGATIVE_INFINITY;
    const bOut = b.metadata.outputLimit ?? Number.NEGATIVE_INFINITY;
    if (aOut !== bOut) return bOut - aOut;
    const aFresh = a.metadata.fetchedAt;
    const bFresh = b.metadata.fetchedAt;
    if (aFresh !== bFresh) return bFresh - aFresh;
    return compareReferences(a.reference, b.reference);
  });
  return { sorted: withScore, heuristic: !hasComparable };
}

function reasonFor(
  mode: SuggestionMode,
  candidate: PolicyCandidate,
  heuristic: boolean,
): string {
  const costStr = Number.isFinite(candidate.effectiveCost)
    ? `cost ${candidate.effectiveCost.toFixed(2)}`
    : "cost unknown";
  const capStr = `capability ${candidate.capabilityScore}`;
  const ref = candidate.reference;
  if (mode === "free") {
    return capReason(`Free · zero cost · ${capStr} · ${ref} · fresh metadata`);
  }
  if (mode === "economy") {
    return capReason(`Economy · ${costStr} · ${capStr} · ${ref}`);
  }
  // performance
  if (heuristic) {
    const ctx = candidate.metadata.contextLimit ?? 0;
    const out = candidate.metadata.outputLimit ?? 0;
    return capReason(`Performance · heuristic · ${capStr} · context ${ctx} · output ${out} · ${ref}`);
  }
  const bench = candidate.metadata.benchmarkScore;
  const benchStr = bench !== null ? `benchmark ${bench}` : "benchmark n/a";
  return capReason(`Performance · ${benchStr} · ${capStr} · ${ref}`);
}

export function suggestForMode(input: PolicyInput): PolicyOutput {
  const joined = joinCandidates(input.catalog, input.metadata, input.providers, input.capabilities);
  const suggestions = new Map<string, AgentSuggestion>();
  for (const agent of input.agents) {
    let sorted: PolicyCandidate[] = [];
    let heuristic = false;
    if (input.mode === "free") {
      const filtered = filterFree(agent, joined, input.sourceStatus);
      // free ranking: capability score desc, reference asc (cost equal zero, so cost tie)
      const withScore = filtered.map((c) => ({ ...c, capabilityScore: capabilityScore(agent, c.capability) }));
      withScore.sort((a, b) => {
        if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
        return compareReferences(a.reference, b.reference);
      });
      sorted = withScore;
      heuristic = false;
    } else if (input.mode === "economy") {
      const filtered = filterEconomyPerformance(agent, joined);
      sorted = sortEconomy(agent, filtered);
      heuristic = false;
    } else {
      const filtered = filterEconomyPerformance(agent, joined);
      const res = sortPerformance(agent, filtered);
      sorted = res.sorted;
      heuristic = res.heuristic;
      // if no candidates after filtering, heuristic should still be true when no comparable bench across filtered set?
      // For empty set, hasComparable false -> heuristic true, but no suggestion emitted so irrelevant.
      // Keep as computed.
    }
    const top = sorted[0];
    if (top === undefined) continue;
    const isPerf = input.mode === "performance";
    suggestions.set(agent, {
      model: top.reference,
      metadata: toSuggestionMetadata(top.metadata),
      reason: reasonFor(input.mode, top, isPerf ? heuristic : false),
      heuristic: isPerf ? heuristic : false,
    });
  }
  return {
    mode: input.mode,
    providers: [...input.providers],
    sourceStatus: input.sourceStatus,
    sourceAgeMs: input.sourceAgeMs,
    warnings: [...input.warnings],
    suggestions,
  };
}

// Export helpers for tests (pure, no I/O)
export const _test = {
  joinCandidates,
  filterFree,
  filterEconomyPerformance,
  sortEconomy,
  sortPerformance,
  hasMinimumCapabilities,
  isContextInadequate,
  effectiveCost,
  category,
  capabilityScore,
};
