/**
 * Catalog of OpenCode-facing, bun/npm-installable LSP servers that
 * AI-EngKit supports. This is the canonical default packaged with the image;
 * the Admin manages per-server enablement and version pinning on top of it.
 */

export interface LspCatalogEntry {
  /** Stable key used in LSP_SERVERS overrides and the lsp block id. */
  readonly serverKey: string;
  /** npm package installed via `bun install -g`. */
  readonly npmPackage: string;
  /** argv for the OpenCode `lsp` block entry (id -> { command }). */
  readonly command: readonly string[];
  /** File extensions this server serves (OpenCode `extensions`). */
  readonly extensions: readonly string[];
  /** Image-baseline enablement (default disabled). */
  readonly defaultEnabled: boolean;
  /**
   * OpenCode starts this server on its own (built-in), so an explicit
   * disable is meaningless: the override layer normalizes it to managed.
   */
  readonly builtinBacked: boolean;
}

export const LSP_CATALOG: readonly LspCatalogEntry[] = [
  {
    serverKey: "typescript",
    npmPackage: "typescript-language-server",
    command: ["typescript-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
    defaultEnabled: false,
    builtinBacked: true,
  },
  {
    serverKey: "json",
    npmPackage: "vscode-langservers-extracted",
    command: ["vscode-json-language-server", "--stdio"],
    extensions: [".json", ".jsonc"],
    defaultEnabled: false,
    builtinBacked: false,
  },
  {
    serverKey: "css",
    npmPackage: "vscode-langservers-extracted",
    command: ["vscode-css-language-server", "--stdio"],
    extensions: [".css", ".scss", ".less"],
    defaultEnabled: false,
    builtinBacked: false,
  },
  {
    serverKey: "html",
    npmPackage: "vscode-langservers-extracted",
    command: ["vscode-html-language-server", "--stdio"],
    extensions: [".html", ".htm"],
    defaultEnabled: false,
    builtinBacked: false,
  },
  {
    // Key matches OpenCode's built-in id so our entry overrides it
    // instead of running a second YAML server alongside `yaml-ls`.
    serverKey: "yaml-ls",
    npmPackage: "yaml-language-server",
    command: ["yaml-language-server", "--stdio"],
    extensions: [".yaml", ".yml"],
    defaultEnabled: false,
    builtinBacked: true,
  },
  {
    serverKey: "dockerfile",
    npmPackage: "dockerfile-language-server-nodejs",
    command: ["docker-langserver", "--stdio"],
    extensions: [".dockerfile", ".Dockerfile"],
    defaultEnabled: false,
    builtinBacked: false,
  },
  {
    serverKey: "biome",
    npmPackage: "@biomejs/biome",
    command: ["biome", "lsp-proxy"],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".json"],
    defaultEnabled: false,
    builtinBacked: false,
  },
  {
    // Same-id override of OpenCode's built-in: single instance, still pinnable.
    serverKey: "pyright",
    npmPackage: "pyright",
    command: ["pyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"],
    defaultEnabled: false,
    builtinBacked: true,
  },
];

export type LspServerKey = (typeof LSP_CATALOG)[number]["serverKey"];

/** Map of serverKey -> catalog entry for O(1) lookup. */
export const LSP_CATALOG_BY_KEY: ReadonlyMap<string, LspCatalogEntry> = new Map(
  LSP_CATALOG.map((entry) => [entry.serverKey, entry]),
);

/**
 * Resolve a stable npm package name to its set of distinct catalog entries.
 * Several servers (json/css/html) share a single package, so one install
 * can cover multiple catalog rows.
 */
export function packageServerKeys(npmPackage: string): readonly LspCatalogEntry[] {
  return LSP_CATALOG.filter((entry) => entry.npmPackage === npmPackage);
}
