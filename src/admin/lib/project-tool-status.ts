import type { ProjectCommand } from "./projects-overview";

/**
 * Per-project tool status probes for the Admin projects overview.
 *
 * The Admin container has no workspace or lean-ctx volumes, so every probe is
 * one `sh -c` command executed inside ai-dev through the injected
 * `ProjectCommand` (the same abstraction all other project operations use).
 *
 * Probes are read-only, time-bounded, cached with a TTL, and bounded in
 * concurrency; a failed probe yields `null` for that project and never blocks
 * the rest of the overview.
 */

export interface CodegraphIndexStatus {
  builtWithVersion?: string;
  builtWithExtractionVersion?: string;
  currentExtractionVersion?: string;
  reindexRecommended?: boolean;
  state?: string;
  pendingRefs?: string[];
}

/** Shape of `codegraph status --json <path>` (subset the Admin surfaces). */
export interface CodegraphStatus {
  initialized: boolean;
  version?: string;
  projectPath?: string;
  indexPath?: string;
  lastIndexed?: string | null;
  fileCount?: number;
  nodeCount?: number;
  edgeCount?: number;
  dbSizeBytes?: number;
  backend?: string;
  journalMode?: string;
  nodesByKind?: Record<string, number>;
  languages?: Record<string, number>;
  pendingChanges?: { added: number; modified: number; removed: number };
  worktreeMismatch?: boolean;
  index?: CodegraphIndexStatus;
}

/**
 * Site-level leanCTX statistics aggregated across every knowledge dir.
 * Per-project leanCTX is intentionally not surfaced: session activity is
 * global and health scores are sparse, so per-project values would mislead.
 */
export interface LeanCtxSiteStats {
  /** Number of projects with at least one stored memory fact. */
  projectsWithFacts: number;
  /** Total memory facts across all projects. */
  totalMemoryFacts: number;
  /** Distinct projects with agent activity within the last 24 hours. */
  activeProjects24h: number;
  /** Projects with a cached health score. */
  healthCoverage: number;
}

/**
 * LeanCTX token-savings telemetry surfaced from `lean-ctx gain --json` plus
 * `lean-ctx savings verify` (SHA-256 ledger chain check). All values are
 * aggregates; none include paths, prompts, or code.
 */
export interface GainStats {
  /** Gross tokens saved before stream overhead. */
  tokensSaved: number;
  /** Net tokens saved after injected stream overhead. */
  netTokensSaved: number;
  /** Effective compression percentage (0-100). */
  compressionPct: number;
  /** Gross USD saved by compression. */
  grossUsdSaved: number;
  /** USD saved after stream overhead. */
  netUsdSaved: number;
  /** USD cost of injected stream overhead (re-reads/bounce). */
  overheadUsd: number;
  /** Bounce tokens — savings lost to cache misses. */
  bounceTokens: number;
  /** SHA-256 savings ledger chain verified intact. */
  ledgerVerified: boolean;
  /** Number of ledger events in the verified chain. */
  ledgerEvents: number;
}

export interface ProjectToolStatus {
  codegraph: CodegraphStatus | null;
}

export interface ProjectToolStatusProvider {
  probe(name: string): Promise<ProjectToolStatus>;
  probeSite(): Promise<LeanCtxSiteStats | null>;
  probeGain(): Promise<GainStats | null>;
  invalidate(name?: string): void;
}

export interface ToolStatusProbeOptions {
  command: ProjectCommand;
  workspaceRoot: string;
  /** Cache TTL in ms (default 300_000). */
  ttlMs?: number;
  /** Max probes in flight, clamped to [4, 8] (default 6). */
  concurrency?: number;
  /** Per-probe command timeout in ms (default 10_000). */
  probeTimeoutMs?: number;
}

const DEFAULT_TTL_MS = 300_000;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

interface CacheEntry {
  at: number;
  value: ProjectToolStatus;
}

/** Single-quote for POSIX sh: ' → '\'' (all other characters are literal). */
function shq(value: string): string {
  return "'" + value.replace(/'/g, `'\\''`) + "'";
}

function createSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    acquire(): Promise<void> {
      return new Promise((resolve) => {
        if (active < max) {
          active += 1;
          resolve();
        } else {
          queue.push(resolve);
        }
      });
    },
    release(): void {
      active -= 1;
      const next = queue.shift();
      if (next) {
        active += 1;
        next();
      }
    },
  };
}

/**
 * Scans every leanCTX knowledge/registry/graph dir and prints site-level
 * aggregates: `projects_with_facts`, `total_memory_facts`, `active_24h`,
 * `health_coverage`. Missing dirs keep zero defaults and the command always
 * exits 0, so parsing decides the result (non-zero exit / thrown command
 * means the scan itself failed → null).
 */
const LEANCTX_SITE_SCRIPT = `
base="$HOME/.local/share/lean-ctx"
dirs=0
facts=0
for f in "$base"/knowledge/*/knowledge.json; do
  [ -f "$f" ] || continue
  dirs=$((dirs+1))
  n=$(jq -r '(.facts | length) // 0' "$f" 2>/dev/null || printf '0')
  case $n in ''|*[!0-9]*) n=0;; esac
  facts=$((facts+n))
done
active=0
reg="$base/agents/registry.json"
if [ -f "$reg" ]; then
  active=$(jq -r '[.[] | select(.last_active != null) | (.last_active | fromdateiso8601? // empty) | select(. >= (now - 86400))] | length' "$reg" 2>/dev/null || printf '0')
fi
health=0
for g in "$base"/graphs/*/health.json; do
  [ -f "$g" ] || continue
  health=$((health+1))
done
printf 'projects_with_facts=%s\\ntotal_memory_facts=%s\\nactive_24h=%s\\nhealth_coverage=%s\\n' "$dirs" "$facts" "$active" "$health"
`.trim();

function parseLeanCtxSiteStats(output: string): LeanCtxSiteStats | null {
  const projects = /^projects_with_facts=(\d+)$/m.exec(output);
  const facts = /^total_memory_facts=(\d+)$/m.exec(output);
  const active = /^active_24h=(\d+)$/m.exec(output);
  const health = /^health_coverage=(\d+)$/m.exec(output);
  if (!projects || !facts || !active || !health) return null;
  return {
    projectsWithFacts: Number(projects[1]),
    totalMemoryFacts: Number(facts[1]),
    activeProjects24h: Number(active[1]),
    healthCoverage: Number(health[1]),
  };
}

/** `gain --json` emits the full summary (model pricing, tasks, heatmap); only the aggregate subset is surfaced. */
const GAIN_JSON_COMMAND = "lean-ctx gain --json 2>/dev/null";
/** `savings verify` prints e.g. "OK — 5812 event(s), SHA-256 chain intact." */
const SAVINGS_VERIFY_COMMAND = "lean-ctx savings verify 2>/dev/null";

function parseGainStats(gainOutput: string, verifyOutput: string): GainStats | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gainOutput);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const summary = (parsed as Record<string, unknown>).summary;
  if (typeof summary !== "object" || summary === null) return null;
  const stream = (summary as Record<string, unknown>).stream_savings;
  if (typeof stream !== "object" || stream === null) return null;

  const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const chainMatch = /(\d+) event\(s\),? SHA-256 chain intact/im.exec(verifyOutput);
  return {
    tokensSaved: num((summary as Record<string, unknown>).tokens_saved),
    netTokensSaved: num((summary as Record<string, unknown>).net_tokens_saved),
    compressionPct: num((summary as Record<string, unknown>).effective_compression_pct),
    grossUsdSaved: num((stream as Record<string, unknown>).gross_usd_saved),
    netUsdSaved: num((stream as Record<string, unknown>).net_usd_saved),
    overheadUsd: num((stream as Record<string, unknown>).overhead_usd),
    bounceTokens: num((stream as Record<string, unknown>).bounce_tokens),
    ledgerVerified: chainMatch !== null,
    ledgerEvents: chainMatch !== null ? Number(chainMatch[1]) : 0,
  };
}

export function createToolStatusProbe(options: ToolStatusProbeOptions): ProjectToolStatusProvider {
  const { command, workspaceRoot } = options;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const concurrency = Math.min(8, Math.max(4, options.concurrency ?? DEFAULT_CONCURRENCY));
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const cache = new Map<string, CacheEntry>();
  const semaphore = createSemaphore(concurrency);
  let siteCache: { at: number; value: LeanCtxSiteStats | null } | null = null;
  let gainCache: { at: number; value: GainStats | null } | null = null;

  async function probeCodegraph(projectRoot: string): Promise<CodegraphStatus | null> {
    try {
      const result = await command(`codegraph status --json ${shq(projectRoot)} 2>/dev/null`, probeTimeoutMs);
      if (result.exitCode !== 0) return null;
      const stdout = result.stdout.trim();
      if (stdout === "") return null;
      const parsed: unknown = JSON.parse(stdout);
      if (typeof parsed !== "object" || parsed === null) return null;
      const record = parsed as Record<string, unknown>;
      if (typeof record.initialized !== "boolean") return null;
      return record as unknown as CodegraphStatus;
    } catch {
      return null;
    }
  }

  async function probeLeanCtxSite(): Promise<LeanCtxSiteStats | null> {
    const now = Date.now();
    if (siteCache !== null && now - siteCache.at < ttlMs) return siteCache.value;
    try {
      const result = await command(LEANCTX_SITE_SCRIPT, probeTimeoutMs);
      const value = result.exitCode === 0 ? parseLeanCtxSiteStats(result.stdout) : null;
      siteCache = { at: Date.now(), value };
      return value;
    } catch {
      siteCache = { at: Date.now(), value: null };
      return null;
    }
  }

  async function probeGain(): Promise<GainStats | null> {
    const now = Date.now();
    if (gainCache !== null && now - gainCache.at < ttlMs) return gainCache.value;
    try {
      const [gainResult, verifyResult] = await Promise.all([
        command(GAIN_JSON_COMMAND, probeTimeoutMs),
        command(SAVINGS_VERIFY_COMMAND, probeTimeoutMs),
      ]);
      const value = gainResult.exitCode === 0 ? parseGainStats(gainResult.stdout, verifyResult.stdout) : null;
      gainCache = { at: Date.now(), value };
      return value;
    } catch {
      gainCache = { at: Date.now(), value: null };
      return null;
    }
  }

  return {
    async probe(name: string): Promise<ProjectToolStatus> {
      const now = Date.now();
      const entry = cache.get(name);
      if (entry !== undefined && now - entry.at < ttlMs) return entry.value;

      await semaphore.acquire();
      try {
        // Another probe for the same project may have filled the cache while
        // we were waiting for a concurrency slot.
        const fresh = cache.get(name);
        if (fresh !== undefined && Date.now() - fresh.at < ttlMs) return fresh.value;

        const projectRoot = `${workspaceRoot}/${name}`;
        const value: ProjectToolStatus = { codegraph: await probeCodegraph(projectRoot) };
        cache.set(name, { at: Date.now(), value });
        return value;
      } finally {
        semaphore.release();
      }
    },
    probeSite: probeLeanCtxSite,
    probeGain,
    invalidate(name?: string): void {
      if (name !== undefined) cache.delete(name);
      else cache.clear();
      siteCache = null;
      gainCache = null;
    },
  };
}
