import { hostname } from "node:os";
import { extractTokenFromUrl } from "./protocol";

/** Resolve a registration token from the center URL or environment. */
export function resolveRegistrationToken(
  centerUrl: string,
  env: Record<string, string | undefined>,
): string | null {
  return extractTokenFromUrl(centerUrl) ?? env["CENTER_TOKEN"] ?? null;
}

/** Resolve the stable agent identifier for protocol messages. */
export function resolveAgentId(env: Record<string, string | undefined>): string {
  return env["AGENT_ID"] || hostname();
}

/** Redact a registration token before including it in logs. */
export function redactTokenForLogging(token: string | null): string {
  return token === null ? "(none)" : `${token.slice(0, 3)}…`;
}
