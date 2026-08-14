import { upsertEnvVar } from "./env";

export type ActivationStatus = "immediate" | "restart_required";

export interface SecretSchemaEntry {
  key: string;
  description: string;
  activationStatus: ActivationStatus;
  category: "admin" | "service";
  note?: string;
}

/** Environment-schema password keys manageable through the Secrets page and remote commands. */
export const SECRETS_SCHEMA: SecretSchemaEntry[] = [
  {
    key: "ADMIN_PASSWORD",
    description: "Admin dashboard login password",
    activationStatus: "immediate",
    category: "admin",
  },
  {
    key: "OPENCHAMBER_UI_PASSWORD",
    description: "OpenChamber Web UI login password",
    activationStatus: "restart_required",
    category: "service",
  },
  {
    key: "OPENCODE_SERVER_PASSWORD",
    description: "OpenCode API authentication",
    activationStatus: "restart_required",
    category: "service",
    note: "OpenCode port is not exposed externally in standard deployment. This password provides defense-in-depth for internal API access and is essential when connecting to a remote OpenCode server via OPENCODE_HOST.",
  },
];

export function isSecretKey(key: string): boolean {
  return SECRETS_SCHEMA.some((entry) => entry.key === key);
}

export function getSecretActivationStatus(key: string): ActivationStatus {
  return SECRETS_SCHEMA.find((entry) => entry.key === key)?.activationStatus ?? "restart_required";
}

/** Persist a schema password key and report when it takes effect. */
export function setSecretValue(key: string, value: string): ActivationStatus {
  upsertEnvVar(key, value);
  return getSecretActivationStatus(key);
}
