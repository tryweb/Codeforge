import { readEnvFile } from "./env";

const REGISTRY_IMAGE = "ghcr.io/tryweb/ai-engkit";

/**
 * Resolve the deployable image reference.
 *
 * Production environments can pin a version via AI_ENGKIT_VERSION in
 * /opt/ai-engkit/.env (e.g. v0.4.1); unset falls back to the stable
 * channel (:latest), which only moves on explicit promotion through the
 * Promote stable workflow.
 */
export function resolveImageRef(): string {
  const version = readEnvFile().AI_ENGKIT_VERSION?.trim();
  return version ? `${REGISTRY_IMAGE}:${version}` : `${REGISTRY_IMAGE}:latest`;
}
