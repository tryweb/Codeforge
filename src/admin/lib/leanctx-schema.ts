export type LeanCtxConfigType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "json"
  | "textarea";

export interface LeanCtxSchemaEntry {
  key: string;
  type: LeanCtxConfigType;
  description: string;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  section?: string;
  deprecated?: boolean;
}

export const LEANCTX_SCHEMA: LeanCtxSchemaEntry[] = [
  // Root level
  {
    key: "compression_level",
    type: "select",
    description: "Master compression dial controlling agent prompt density, output density, CRP mode, and token-model tuning",
    default: "lite",
    options: ["off", "lite", "standard", "max"],
    section: "Core",
  },
  {
    key: "cognitive_mode",
    type: "select",
    description: "Token budget mode for context window management",
    default: "full",
    options: ["compact", "full"],
    section: "Core",
  },
  {
    key: "permission_inheritance",
    type: "select",
    description: "Shell permission inheritance behavior",
    default: "on",
    options: ["on", "off"],
    section: "Core",
  },
  {
    key: "shell_allowlist_extra",
    type: "json",
    description: "Extra allowed shell commands (JSON array of strings)",
    default: [],
    section: "Core",
  },
  {
    key: "graph_index_max_files",
    type: "number",
    description: "Maximum files for codegraph indexing",
    default: 5000,
    min: 100,
    max: 50000,
    section: "Core",
  },
  {
    key: "savings_footer",
    type: "select",
    description: "Show savings footer in tool output",
    default: "auto",
    options: ["auto", "always", "never"],
    section: "Core",
  },
  {
    key: "allow_ide_config_dirs",
    type: "boolean",
    description: "Allow IDE config directories in PathJail",
    default: true,
    section: "Core",
  },

  // Archive section
  {
    key: "archive.enabled",
    type: "boolean",
    description: "Enable output archiving for large results",
    default: true,
    section: "Archive",
  },
  {
    key: "archive.threshold_chars",
    type: "number",
    description: "Minimum output size (characters) to trigger archiving",
    default: 800,
    min: 100,
    max: 100000,
    section: "Archive",
  },
  {
    key: "archive.max_age_hours",
    type: "number",
    description: "Maximum age of archived entries before cleanup (hours)",
    default: 48,
    min: 1,
    max: 8760,
    section: "Archive",
  },
  {
    key: "archive.max_disk_mb",
    type: "number",
    description: "Maximum total disk usage for archives (MB)",
    default: 500,
    min: 10,
    max: 10000,
    section: "Archive",
  },
  {
    key: "archive.ephemeral",
    type: "boolean",
    description: "Replace large results with summary + ctx_expand reference",
    default: true,
    section: "Archive",
  },

  // Budget / Information Gate section
  {
    key: "budget.information_gate.enabled",
    type: "boolean",
    description: "Enable Marginal Information Gate (MIG) — suppresses redundant tool responses",
    default: true,
    section: "Budget",
  },
  {
    key: "budget.information_gate.max_overlap_ratio",
    type: "number",
    description: "Suppress response if overlap with already-delivered content exceeds this ratio (0.0-1.0)",
    default: 0.85,
    min: 0,
    max: 1,
    section: "Budget",
  },
  {
    key: "budget.information_gate.min_novel_lines",
    type: "number",
    description: "Suppress response if fewer than this many novel lines",
    default: 3,
    min: 0,
    max: 100,
    section: "Budget",
  },
  {
    key: "budget.information_gate.track_granularity",
    type: "select",
    description: "Granularity for tracking delivered content",
    default: "line",
    options: ["line", "chunk", "file"],
    section: "Budget",
  },

  // Tools / Profile section
  {
    key: "tools.profile",
    type: "select",
    description: "MCP tool profile — how many of the 67+ tools are exposed to the agent",
    default: "power",
    options: ["minimal", "standard", "power"],
    section: "Tools",
  },

  // Autonomy section
  {
    key: "autonomy.auto_preload",
    type: "boolean",
    description: "Auto-preload imported files after ctx_read",
    default: true,
    section: "Autonomy",
  },
  {
    key: "autonomy.auto_dedup",
    type: "boolean",
    description: "Auto-deduplicate at 8+ cached files",
    default: true,
    section: "Autonomy",
  },
  {
    key: "autonomy.auto_related",
    type: "boolean",
    description: "Suggest related files via import graph",
    default: true,
    section: "Autonomy",
  },
  {
    key: "autonomy.auto_consolidate",
    type: "boolean",
    description: "Auto-consolidate knowledge periodically",
    default: true,
    section: "Autonomy",
  },
  {
    key: "autonomy.silent_preload",
    type: "boolean",
    description: "Cache files without output",
    default: true,
    section: "Autonomy",
  },
  {
    key: "autonomy.dedup_threshold",
    type: "number",
    description: "Number of files before auto-dedup triggers",
    default: 8,
    min: 2,
    max: 50,
    section: "Autonomy",
  },
  {
    key: "autonomy.consolidate_every_calls",
    type: "number",
    description: "Run consolidation every N tool calls",
    default: 25,
    min: 5,
    max: 200,
    section: "Autonomy",
  },
  {
    key: "autonomy.consolidate_cooldown_secs",
    type: "number",
    description: "Minimum seconds between consolidations",
    default: 120,
    min: 10,
    max: 3600,
    section: "Autonomy",
  },
  {
    key: "autonomy.cognition_loop_enabled",
    type: "boolean",
    description: "Enable background cognition loop for knowledge consolidation",
    default: true,
    section: "Autonomy",
  },
  {
    key: "autonomy.cognition_loop_interval_secs",
    type: "number",
    description: "Seconds between cognition-loop iterations",
    default: 3600,
    min: 60,
    max: 86400,
    section: "Autonomy",
  },
  {
    key: "autonomy.cognition_loop_max_steps",
    type: "number",
    description: "Maximum reasoning steps per cognition-loop iteration",
    default: 8,
    min: 1,
    max: 50,
    section: "Autonomy",
  },

  // Search section
  {
    key: "search.bm25_weight",
    type: "number",
    description: "BM25 weight for hybrid search",
    default: 1.0,
    min: 0,
    max: 10,
    section: "Search",
  },
  {
    key: "search.dense_weight",
    type: "number",
    description: "Dense embedding weight for hybrid search",
    default: 1.0,
    min: 0,
    max: 10,
    section: "Search",
  },
  {
    key: "search.splade_weight",
    type: "number",
    description: "SPLADE weight for hybrid search",
    default: 0.5,
    min: 0,
    max: 10,
    section: "Search",
  },
  {
    key: "search.candidate_count",
    type: "number",
    description: "Number of candidates for semantic search",
    default: 100,
    min: 10,
    max: 1000,
    section: "Search",
  },

  // Memory section
  {
    key: "memory.knowledge.max_facts",
    type: "number",
    description: "Maximum facts in knowledge base",
    default: 200,
    min: 50,
    max: 5000,
    section: "Memory",
  },
  {
    key: "memory.episodic.max_episodes",
    type: "number",
    description: "Maximum episodes in episodic memory",
    default: 500,
    min: 50,
    max: 10000,
    section: "Memory",
  },
  {
    key: "memory.procedural.max_procedures",
    type: "number",
    description: "Maximum procedures in procedural memory",
    default: 100,
    min: 10,
    max: 2000,
    section: "Memory",
  },

  // Loop detection section
  {
    key: "loop_detection.enabled",
    type: "boolean",
    description: "Enable per-tool call limits to prevent agent loops",
    default: true,
    section: "Loop Detection",
  },
  {
    key: "loop_detection.max_calls_per_tool",
    type: "number",
    description: "Maximum calls per tool per turn",
    default: 50,
    min: 5,
    max: 500,
    section: "Loop Detection",
  },
  {
    key: "loop_detection.max_total_calls",
    type: "number",
    description: "Maximum total tool calls per turn",
    default: 200,
    min: 20,
    max: 2000,
    section: "Loop Detection",
  },

  // Updates section
  {
    key: "updates.auto_update",
    type: "boolean",
    description: "Auto-update lean-ctx binary",
    default: false,
    section: "Updates",
  },
  {
    key: "updates.check_interval_hours",
    type: "number",
    description: "Hours between update checks",
    default: 6,
    min: 1,
    max: 168,
    section: "Updates",
  },
  {
    key: "updates.notify_only",
    type: "boolean",
    description: "Only notify, don't auto-update",
    default: true,
    section: "Updates",
  },

  // Boundary policy section
  {
    key: "boundary_policy.cross_project_search",
    type: "boolean",
    description: "Allow cross-project search/import",
    default: false,
    section: "Boundary Policy",
  },
  {
    key: "boundary_policy.universal_gotchas",
    type: "boolean",
    description: "Share gotchas across projects",
    default: false,
    section: "Boundary Policy",
  },

  // Secret detection section
  {
    key: "secret_detection.enabled",
    type: "boolean",
    description: "Enable secret redaction in output",
    default: true,
    section: "Secret Detection",
  },
  {
    key: "secret_detection.redact_in_archive",
    type: "boolean",
    description: "Redact secrets in archived output",
    default: true,
    section: "Secret Detection",
  },

  // Proxy section
  {
    key: "proxy.enabled",
    type: "boolean",
    description: "Enable local proxy for request compression",
    default: false,
    section: "Proxy",
  },
  {
    key: "proxy.port",
    type: "number",
    description: "Proxy port",
    default: 4444,
    min: 1024,
    max: 65535,
    section: "Proxy",
  },
];

export function getSchemaBySection(): Record<string, LeanCtxSchemaEntry[]> {
  const sections: Record<string, LeanCtxSchemaEntry[]> = {};
  for (const entry of LEANCTX_SCHEMA) {
    const section = entry.section || "Other";
    if (!sections[section]) sections[section] = [];
    sections[section].push(entry);
  }
  return sections;
}

export function getSchemaEntry(key: string): LeanCtxSchemaEntry | undefined {
  return LEANCTX_SCHEMA.find((e) => e.key === key);
}

export function getDefaultConfig(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const entry of LEANCTX_SCHEMA) {
    if (entry.default !== undefined) {
      defaults[entry.key] = entry.default;
    }
  }
  return defaults;
}