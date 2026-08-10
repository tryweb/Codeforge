export interface EnvSchemaEntry {
  key: string;
  type: string;
  description: string;
}

export const ENV_SCHEMA: EnvSchemaEntry[] = [
  { key: "ADMIN_PORT", type: "port", description: "Admin dashboard port (production)" },
  { key: "ADMIN_DEV_PORT", type: "port", description: "Admin dashboard port (development)" },
  { key: "ADMIN_PASSWORD", type: "password", description: "Admin dashboard password" },
  { key: "OPENCHAMBER_UI_PASSWORD", type: "password", description: "OpenChamber web UI password" },
  { key: "OPENCODE_SERVER_PASSWORD", type: "password", description: "OpenCode server password" },
  { key: "OPENCODE_PROVIDER", type: "json", description: "OpenCode provider configuration" },
  { key: "OPENCODE_PLUGINS", type: "text", description: "OpenCode plugins (comma-separated)" },
  { key: "CHAMBER_PORT", type: "port", description: "OpenChamber port" },
  { key: "BACKUP_RETENTION", type: "number", description: "Number of backups to retain" },
  { key: "WORKSPACE_PATH", type: "text", description: "Workspace path (bind mount)" },
  { key: "APT_PACKAGES", type: "text", description: "Extra apt packages installed at container startup" },
  { key: "BREW_PACKAGES", type: "text", description: "Extra Homebrew packages installed at container startup" },
  { key: "BUN_PACKAGES", type: "text", description: "Extra global bun packages installed at container startup" },
];

export const PASSWORD_KEYS: string[] = ENV_SCHEMA.filter((entry) => entry.type === "password").map(
  (entry) => entry.key,
);
