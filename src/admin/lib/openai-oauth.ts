/**
 * ChatGPT Pro/Plus headless device-code OAuth for the OpenAI provider.
 * Mirrors the official OpenCode device flow. Tokens never reach the browser;
 * pending flow state stays server-side. HTTPS endpoints + client ID hardcoded.
 */

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_ISSUER = "https://auth.openai.com";
export const OPENAI_OAUTH_VERIFY_URL = "https://auth.openai.com/codex/device";
export const OPENAI_OAUTH_REDIRECT_URI = `${OPENAI_OAUTH_ISSUER}/deviceauth/callback`;
export const OPENAI_OAUTH_DEFAULT_EXPIRES_IN_SEC = 600;

export interface OAuthAuthEntry {
  type: "oauth";
  access: string;
  refresh: string;
  /** Milliseconds since epoch (OpenCode stores a numeric expiry). */
  expires: number;
  accountId?: string;
}

export interface DeviceUserCode {
  /** Server-side polling credential — never exposed to the browser. */
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  intervalSec: number;
  expiresInSec: number;
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "ready"; authorizationCode: string; codeVerifier: string }
  | { status: "failed" };

export interface OAuthTokenSet {
  access: string;
  refresh: string;
  idToken?: string;
  expiresInSec?: number;
  accountId?: string;
}

export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const UA = "ai-engkit-admin";

function parseDeviceUserCode(body: unknown): DeviceUserCode {
  if (typeof body !== "object" || body === null) {
    throw new Error("Device authorization returned an invalid response");
  }
  const value = body as Record<string, unknown>;
  const deviceAuthId = typeof value["device_auth_id"] === "string" ? value["device_auth_id"] : "";
  const userCode = typeof value["user_code"] === "string" ? value["user_code"] : "";
  if (!deviceAuthId || !userCode) {
    throw new Error("Device authorization response missing device_auth_id or user_code");
  }
  const parsedInterval = typeof value["interval"] === "string" ? parseInt(value["interval"], 10) : NaN;
  const intervalSec = Math.max(Number.isFinite(parsedInterval) ? parsedInterval : 5, 1);
  const expiresInSec =
    typeof value["expires_in"] === "number" && value["expires_in"] > 0
      ? Math.floor(value["expires_in"])
      : OPENAI_OAUTH_DEFAULT_EXPIRES_IN_SEC;
  const verificationUri =
    typeof value["verification_uri"] === "string" && value["verification_uri"].startsWith("https://")
      ? value["verification_uri"]
      : OPENAI_OAUTH_VERIFY_URL;
  return { deviceAuthId, userCode, verificationUri, intervalSec, expiresInSec };
}

/** Start the device flow: POST /api/accounts/deviceauth/usercode. */
export async function requestDeviceUserCode(
  fetchImpl: HttpFetch = fetch,
): Promise<DeviceUserCode> {
  const response = await fetchImpl(`${OPENAI_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ client_id: OPENAI_OAUTH_CLIENT_ID }),
  });
  if (!response.ok) {
    throw new Error(`Failed to initiate device authorization: ${response.status}`);
  }
  return parseDeviceUserCode(await response.json());
}

/** One HTTP round-trip poll; bounded polling is orchestrated by the caller. */
export async function pollDeviceToken(
  deviceAuthId: string,
  userCode: string,
  fetchImpl: HttpFetch = fetch,
): Promise<DevicePollResult> {
  const response = await fetchImpl(`${OPENAI_OAUTH_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  });
  if (response.ok) {
    const body: unknown = await response.json();
    const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const authorizationCode =
      typeof value["authorization_code"] === "string" ? value["authorization_code"] : "";
    const codeVerifier = typeof value["code_verifier"] === "string" ? value["code_verifier"] : "";
    if (!authorizationCode || !codeVerifier) return { status: "failed" };
    return { status: "ready", authorizationCode, codeVerifier };
  }
  // 403/404 mean the user has not authorized yet; anything else is terminal.
  if (response.status === 403 || response.status === 404) return { status: "pending" };
  return { status: "failed" };
}

interface RawTokenResponse {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

function parseTokenResponse(body: unknown): RawTokenResponse {
  if (typeof body !== "object" || body === null) return {};
  return body as RawTokenResponse;
}

/** Exchange code + verifier at /oauth/token; raw tokens only enter the auth store. */
export async function exchangeAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  fetchImpl: HttpFetch = fetch,
): Promise<OAuthTokenSet> {
  const response = await fetchImpl(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }
  const raw = parseTokenResponse(await response.json());
  if (typeof raw.access_token !== "string" || typeof raw.refresh_token !== "string") {
    throw new Error("Token exchange returned an incomplete token set");
  }
  const expiresInSec = typeof raw.expires_in === "number" && raw.expires_in > 0 ? raw.expires_in : undefined;
  return {
    access: raw.access_token,
    refresh: raw.refresh_token,
    idToken: typeof raw.id_token === "string" ? raw.id_token : undefined,
    expiresInSec,
    accountId: extractAccountIdFromTokens({
      idToken: typeof raw.id_token === "string" ? raw.id_token : undefined,
      access: raw.access_token,
    }),
  };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/** Extract the account id from id/access token claims (OpenCode semantics). */
export function extractAccountIdFromJwt(jwt: string): string | undefined {
  const claims = decodeJwtPayload(jwt);
  if (!claims) return undefined;
  const direct = claims["chatgpt_account_id"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const nested = claims["https://api.openai.com/auth"];
  if (nested !== null && typeof nested === "object") {
    const nestedId = (nested as Record<string, unknown>)["chatgpt_account_id"];
    if (typeof nestedId === "string" && nestedId.length > 0) return nestedId;
  }
  const organizations = claims["organizations"];
  if (Array.isArray(organizations) && organizations.length > 0) {
    const first = organizations[0];
    if (first !== null && typeof first === "object") {
      const orgId = (first as Record<string, unknown>)["id"];
      if (typeof orgId === "string" && orgId.length > 0) return orgId;
    }
  }
  return undefined;
}

function extractAccountIdFromTokens(tokens: { idToken?: string; access?: string }): string | undefined {
  if (tokens.idToken) {
    const fromId = extractAccountIdFromJwt(tokens.idToken);
    if (fromId) return fromId;
  }
  if (tokens.access) return extractAccountIdFromJwt(tokens.access);
  return undefined;
}

/** Pure: build the auth-store entry; injectable clock for tests. */
export function buildOAuthEntry(tokens: OAuthTokenSet, now = Date.now()): OAuthAuthEntry {
  const expiresInSec = tokens.expiresInSec ?? 3600;
  const entry: OAuthAuthEntry = {
    type: "oauth",
    access: tokens.access,
    refresh: tokens.refresh,
    expires: now + expiresInSec * 1000,
  };
  const accountId = tokens.accountId ?? extractAccountIdFromTokens(tokens);
  if (accountId) entry.accountId = accountId;
  return entry;
}

interface PendingOAuthFlow {
  deviceAuthId: string;
  userCode: string;
  intervalSec: number;
  expiresAtMs: number;
  authorizationCode?: string;
  codeVerifier?: string;
}

const pendingFlows = new Map<string, PendingOAuthFlow>();

/** Register a started flow and return its non-sensitive id. */
export function startPendingFlow(info: DeviceUserCode, now = Date.now()): string {
  const flowId = `oauth-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  pendingFlows.set(flowId, {
    deviceAuthId: info.deviceAuthId,
    userCode: info.userCode,
    intervalSec: info.intervalSec,
    expiresAtMs: now + info.expiresInSec * 1000,
  });
  return flowId;
}

/** Read a live flow; expired or unknown flows resolve to null (and are dropped). */
export function getPendingFlow(flowId: string, now = Date.now()): PendingOAuthFlow | null {
  const flow = pendingFlows.get(flowId);
  if (!flow) return null;
  if (now > flow.expiresAtMs) {
    pendingFlows.delete(flowId);
    return null;
  }
  return flow;
}

export function markPendingFlowReady(
  flowId: string,
  authorizationCode: string,
  codeVerifier: string,
): boolean {
  const flow = pendingFlows.get(flowId);
  if (!flow) return false;
  flow.authorizationCode = authorizationCode;
  flow.codeVerifier = codeVerifier;
  return true;
}

export function clearPendingFlow(flowId: string): void {
  pendingFlows.delete(flowId);
}

export function pendingFlowCount(): number {
  return pendingFlows.size;
}
