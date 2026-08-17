import { describe, expect, test } from "bun:test";
import {
  buildOAuthEntry,
  clearPendingFlow,
  exchangeAuthorizationCode,
  extractAccountIdFromJwt,
  getPendingFlow,
  markPendingFlowReady,
  pendingFlowCount,
  pollDeviceToken,
  requestDeviceUserCode,
  startPendingFlow,
  type DeviceUserCode,
  type HttpFetch,
} from "./openai-oauth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(claims: Record<string, unknown>): string {
  return `header.${b64url(JSON.stringify(claims))}.sig`;
}

const USERCODE_BODY = {
  device_auth_id: "da-1",
  user_code: "ABCD-EFGH",
  interval: "5",
  expires_in: 600,
  verification_uri: "https://auth.openai.com/codex/device",
};

describe("requestDeviceUserCode", () => {
  test("parses the device authorization response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: HttpFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse(USERCODE_BODY);
    };
    const info = await requestDeviceUserCode(fetchImpl);
    expect(info).toEqual({
      deviceAuthId: "da-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://auth.openai.com/codex/device",
      intervalSec: 5,
      expiresInSec: 600,
    });
    expect(calls[0].url).toContain("/api/accounts/deviceauth/usercode");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(JSON.stringify({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" }));
  });

  test("rejects a response missing device_auth_id or user_code", async () => {
    const fetchImpl: HttpFetch = async () => jsonResponse({ user_code: "ABCD-EFGH" });
    await expect(requestDeviceUserCode(fetchImpl)).rejects.toThrow("missing device_auth_id or user_code");
  });

  test("rejects when the endpoint errors", async () => {
    const fetchImpl: HttpFetch = async () => jsonResponse({}, 502);
    await expect(requestDeviceUserCode(fetchImpl)).rejects.toThrow("502");
  });
});

describe("pollDeviceToken", () => {
  test("returns ready with the authorization code and verifier", async () => {
    const fetchImpl: HttpFetch = async () =>
      jsonResponse({ authorization_code: "ac-1", code_verifier: "cv-1" });
    const result = await pollDeviceToken("da-1", "ABCD-EFGH", fetchImpl);
    expect(result).toEqual({ status: "ready", authorizationCode: "ac-1", codeVerifier: "cv-1" });
  });

  test("reports pending while the user has not authorized (403/404)", async () => {
    for (const status of [403, 404]) {
      const fetchImpl: HttpFetch = async () => jsonResponse({}, status);
      expect(await pollDeviceToken("da-1", "ABCD-EFGH", fetchImpl)).toEqual({ status: "pending" });
    }
  });

  test("reports failed on terminal errors and incomplete ready payloads", async () => {
    const failing: HttpFetch = async () => jsonResponse({}, 500);
    expect(await pollDeviceToken("da-1", "ABCD-EFGH", failing)).toEqual({ status: "failed" });
    const incomplete: HttpFetch = async () => jsonResponse({ authorization_code: "ac-1" });
    expect(await pollDeviceToken("da-1", "ABCD-EFGH", incomplete)).toEqual({ status: "failed" });
  });
});

describe("exchangeAuthorizationCode", () => {
  test("returns tokens and extracts the account id from the id token", async () => {
    const idToken = jwt({ chatgpt_account_id: "acc-123" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: HttpFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ id_token: idToken, access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 });
    };
    const tokens = await exchangeAuthorizationCode("ac-1", "cv-1", fetchImpl);
    expect(tokens.access).toBe("at-1");
    expect(tokens.refresh).toBe("rt-1");
    expect(tokens.expiresInSec).toBe(3600);
    expect(tokens.accountId).toBe("acc-123");
    const body = calls[0].init?.body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=ac-1");
    expect(body).toContain("code_verifier=cv-1");
    expect(body).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
  });

  test("rejects on endpoint errors", async () => {
    const fetchImpl: HttpFetch = async () => jsonResponse({}, 400);
    await expect(exchangeAuthorizationCode("ac-1", "cv-1", fetchImpl)).rejects.toThrow("400");
  });

  test("rejects an incomplete token set", async () => {
    const fetchImpl: HttpFetch = async () => jsonResponse({ access_token: "at-1" });
    await expect(exchangeAuthorizationCode("ac-1", "cv-1", fetchImpl)).rejects.toThrow("incomplete");
  });
});

describe("extractAccountIdFromJwt", () => {
  test("reads the direct chatgpt_account_id claim", () => {
    expect(extractAccountIdFromJwt(jwt({ chatgpt_account_id: "acc-1" }))).toBe("acc-1");
  });

  test("reads the nested auth claim", () => {
    expect(
      extractAccountIdFromJwt(jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-2" } })),
    ).toBe("acc-2");
  });

  test("falls back to the first organization id", () => {
    expect(extractAccountIdFromJwt(jwt({ organizations: [{ id: "org-1" }, { id: "org-2" }] }))).toBe("org-1");
  });

  test("returns undefined without a usable claim", () => {
    expect(extractAccountIdFromJwt(jwt({ sub: "u-1" }))).toBeUndefined();
    expect(extractAccountIdFromJwt("not-a-jwt")).toBeUndefined();
  });
});

describe("buildOAuthEntry", () => {
  test("builds the OpenCode auth-store shape with a numeric ms expiry", () => {
    const entry = buildOAuthEntry(
      { access: "at-1", refresh: "rt-1", expiresInSec: 3600, accountId: "acc-1" },
      1_000,
    );
    expect(entry).toEqual({
      type: "oauth",
      access: "at-1",
      refresh: "rt-1",
      expires: 1_000 + 3600 * 1000,
      accountId: "acc-1",
    });
  });

  test("extracts the account id from the id token when not provided", () => {
    const idToken = jwt({ chatgpt_account_id: "acc-9" });
    const entry = buildOAuthEntry({ access: "at-1", refresh: "rt-1", idToken }, 0);
    expect(entry.accountId).toBe("acc-9");
  });
});

describe("pending flow store", () => {
  const info: DeviceUserCode = {
    deviceAuthId: "da-1",
    userCode: "ABCD-EFGH",
    verificationUri: "https://auth.openai.com/codex/device",
    intervalSec: 5,
    expiresInSec: 600,
  };

  test("tracks, expires, and clears flows", () => {
    const baseline = pendingFlowCount();
    const flowId = startPendingFlow(info, 1_000);
    expect(flowId).toContain("oauth-");
    expect(getPendingFlow(flowId, 2_000)).not.toBeNull();
    expect(getPendingFlow(flowId, 1_000 + 600 * 1000 + 1)).toBeNull();
    expect(pendingFlowCount()).toBe(baseline);
  });

  test("records the authorization result and clears on demand", () => {
    const baseline = pendingFlowCount();
    const flowId = startPendingFlow(info, 1_000);
    expect(markPendingFlowReady(flowId, "ac-1", "cv-1")).toBe(true);
    const ready = getPendingFlow(flowId, 2_000);
    expect(ready?.authorizationCode).toBe("ac-1");
    expect(ready?.codeVerifier).toBe("cv-1");
    clearPendingFlow(flowId);
    expect(getPendingFlow(flowId, 2_000)).toBeNull();
    expect(pendingFlowCount()).toBe(baseline);
    expect(markPendingFlowReady("missing", "ac-1", "cv-1")).toBe(false);
  });
});