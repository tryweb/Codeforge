import type { EnvVars } from "./env";
import { maskKey } from "./provider-keys";
import { PROVIDER_ENV_KEY } from "./providers";
import { PASSWORD_KEYS } from "./env-schema";

/**
 * Redact an env map for the center query path: OPENCODE_PROVIDER carries raw
 * key material (options.apiKey) and is dropped entirely; password-typed schema
 * keys are masked (first 4 + last 4, bullet-only for short values); every
 * other key passes through untouched. The input map is not mutated.
 */
export function redactEnvVars(vars: EnvVars): EnvVars {
  const redacted: EnvVars = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key === PROVIDER_ENV_KEY) continue;
    redacted[key] = PASSWORD_KEYS.includes(key) ? maskKey(value) : value;
  }
  return redacted;
}
