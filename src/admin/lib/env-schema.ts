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
  { key: "CENTER_URL", type: "text", description: "Center server WebSocket URL (enables agent mode)" },
  { key: "CENTER_TOKEN", type: "password", description: "Pre-shared token for center registration (fallback when no ?token= in CENTER_URL)" },
  { key: "AGENT_ID", type: "text", description: "Agent identifier reported in hello handshake (default: container hostname)" },
  { key: "CENTER_CA_CERT", type: "text", description: "Path to mTLS CA certificate" },
  { key: "CENTER_CLIENT_CERT", type: "text", description: "Path to mTLS client certificate" },
  { key: "CENTER_CLIENT_KEY", type: "text", description: "Path to mTLS client private key" },
];

export const PASSWORD_KEYS: string[] = ENV_SCHEMA.filter((entry) => entry.type === "password").map(
  (entry) => entry.key,
);
