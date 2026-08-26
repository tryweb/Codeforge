import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { AgentModelsDeps } from "./agent-model-types";
import {
  computeProviderCredentialFingerprint,
  invalidateProbeCacheForProvider,
  pruneStaleProbeCacheForProvider,
  probeModel,
} from "./model-probe";

type AuthStore = Record<string, unknown>;

function stubDeps(auth: AuthStore, initialCache: Record<string, unknown> = {}) {
  let cache = JSON.stringify(initialCache);
  let probeCount = 0;
  let probeExitCode = 0;
  const calls: string[] = [];
  const deps: Pick<AgentModelsDeps, "exec" | "readEnv"> = {
    exec: async (command: string) => {
      calls.push(command);
      if (command.includes("auth.json")) {
        const match = command.match(/\.\[\"([^\"]+)\"\]/);
        const providerID = match?.[1] ?? "";
        const entry = auth[providerID];
        return { stdout: entry === undefined ? "" : JSON.stringify(entry), stderr: "", exitCode: 0 };
      }
      if (command.includes("agent-model-health.json.tmp")) {
        const encoded = command.match(/printf '%s' '([^']+)'/i)?.[1] ?? "";
        cache = Buffer.from(encoded, "base64").toString("utf8");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("agent-model-health.json")) {
        return { stdout: cache, stderr: "", exitCode: 0 };
      }
      probeCount += 1;
      if (probeExitCode !== 0) return { stdout: "", stderr: "probe failed", exitCode: probeExitCode };
      return {
        stdout: JSON.stringify({ info: { role: "assistant", modelID: "model", providerID: "provider" } }),
        stderr: "",
        exitCode: 0,
      };
    },
    readEnv: () => ({ OPENCODE_SERVER_PASSWORD: "testpass" }),
  };
  return {
    deps,
    auth,
    calls,
    get probeCount() { return probeCount; },
    readCache: () => JSON.parse(cache) as Record<string, unknown>,
    setProbeFailure: () => { probeExitCode = 1; },
  };
}

const credential = { type: "oauth", access: "access-a", refresh: "refresh-a", expires: 123, accountId: "account-a" };

describe("provider credential scoped model probe cache", () => {
  test("same fingerprint and model reuses the cached result", async () => {
    const fixture = stubDeps({ provider: credential });

    const first = await probeModel(fixture.deps, "provider", "model");
    const second = await probeModel(fixture.deps, "provider", "model");

    expect(first).toEqual({ status: "healthy" });
    expect(second.status).toBe(first.status);
    expect(fixture.probeCount).toBe(1);
  });

  test("changed credentials cause a cache miss and re-probe", async () => {
    const fixture = stubDeps({ provider: credential });
    await probeModel(fixture.deps, "provider", "model");
    fixture.auth.provider = { ...credential, access: "access-b" };
    await probeModel(fixture.deps, "provider", "model");
    expect(fixture.probeCount).toBe(2);
  });

  test("stale credential fingerprint entries are pruned on re-probe", async () => {
    const fixture = stubDeps({ provider: credential });
    await probeModel(fixture.deps, "provider", "model");
    fixture.auth.provider = { ...credential, access: "access-b" };
    await probeModel(fixture.deps, "provider", "model");
    const keys = Object.keys(fixture.readCache());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStartWith("provider|");
    expect(keys[0]).toContain("|provider/model");
  });

  test("stale credential entries are pruned when the replacement probe is unreachable", async () => {
    const fixture = stubDeps({ provider: credential });
    await probeModel(fixture.deps, "provider", "model");
    fixture.auth.provider = { ...credential, access: "access-b" };
    fixture.setProbeFailure();

    const result = await probeModel(fixture.deps, "provider", "model");

    expect(result.status).toBe("unreachable");
    expect(Object.keys(fixture.readCache())).toHaveLength(0);
  });

  test("provider A credential changes do not invalidate provider B", async () => {
    const fixture = stubDeps({ providerA: credential, providerB: credential });

    await probeModel(fixture.deps, "providerB", "model");
    await probeModel(fixture.deps, "providerA", "model");
    fixture.auth.providerA = { ...credential, access: "access-a2" };
    await probeModel(fixture.deps, "providerB", "model");
    expect(fixture.probeCount).toBe(2);
  });

  test("legacy bare-model keys are misses", async () => {
    const fixture = stubDeps({ provider: credential }, { "provider/model": { status: "healthy", reason: "", retryAfter: 9_999_999_999 } });

    await probeModel(fixture.deps, "provider", "model");

    expect(fixture.probeCount).toBe(1);
  });

  test("invalidating a provider removes only that provider entries", async () => {
    const fixture = stubDeps({ "opencode-go": credential, openai: credential });
    await probeModel(fixture.deps, "opencode-go", "model");
    await probeModel(fixture.deps, "openai", "model");
    await invalidateProbeCacheForProvider(fixture.deps, "opencode-go");
    const after = fixture.readCache();

    expect(Object.keys(after)).toHaveLength(1);
    expect(Object.keys(after)[0]).toStartWith("openai|");
  });

  test("provider cache rotation prunes stale entries even without a model probe", async () => {
    const fixture = stubDeps({ provider: credential, other: credential });
    await probeModel(fixture.deps, "provider", "model");
    await probeModel(fixture.deps, "other", "model");
    fixture.auth.provider = { ...credential, access: "access-b" };

    await pruneStaleProbeCacheForProvider(fixture.deps, "provider");

    const keys = Object.keys(fixture.readCache());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStartWith("other|");
  });

  test("fingerprints and credentials are not exposed in probe results", async () => {
    const fixture = stubDeps({ provider: credential });
    const fingerprint = await computeProviderCredentialFingerprint(fixture.deps, "provider");
    const result = await probeModel(fixture.deps, "provider", "model");

    expect(fingerprint).toBe(createHash("sha256").update(JSON.stringify({ access: "access-a", accountId: "account-a", expires: 123, refresh: "refresh-a", type: "oauth" })).digest("hex"));
    expect(JSON.stringify(result)).not.toContain(fingerprint);
    expect(JSON.stringify(result)).not.toContain("access-a");
  });
});
