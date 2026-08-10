import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface TlsConfig {
  ca: string | null;
  clientCert: string | null;
  clientKey: string | null;
  configured: boolean;
}

/** Resolve certificate paths and whether complete mTLS configuration exists. */
export function resolveTlsConfig(env: Record<string, string | undefined>): TlsConfig {
  const ca = env["CENTER_CA_CERT"] || null;
  const clientCert = env["CENTER_CLIENT_CERT"] || null;
  const clientKey = env["CENTER_CLIENT_KEY"] || null;
  const configured =
    ca !== null &&
    clientCert !== null &&
    clientKey !== null &&
    existsSync(ca) &&
    existsSync(clientCert) &&
    existsSync(clientKey);

  return { ca, clientCert, clientKey, configured };
}

async function readOptionalFile(path: string | null): Promise<string | null> {
  return path === null ? null : readFile(path, "utf-8");
}

/** Read the current certificate contents for a connection attempt. */
export async function readTlsFiles(
  cfg: TlsConfig,
): Promise<{ ca: string | null; clientCert: string | null; clientKey: string | null }> {
  const [ca, clientCert, clientKey] = await Promise.all([
    readOptionalFile(cfg.ca),
    readOptionalFile(cfg.clientCert),
    readOptionalFile(cfg.clientKey),
  ]);
  return { ca, clientCert, clientKey };
}
