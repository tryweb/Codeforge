import { describe, expect, test } from "bun:test";
import { PASSWORD_KEYS } from "../lib/env-schema";
import { readEnvFile } from "../lib/env";
import { KEY_MANAGED_PROVIDERS } from "../lib/opencode-auth";
import { collectProjectOverviews } from "../lib/projects-overview";
import { collectProvidersMeta } from "../lib/provider-meta";
import type { ProviderKey, ProviderKeysFile } from "../lib/provider-keys";
import { collectStatus } from "../lib/status";
import type { CommandDeps, CommandSender, IdleWaitOutcome } from "./commands";
import { createCommandDispatcher, createRealCommandDeps, waitForIdleSessions } from "./commands";
import type { StatusReport } from "./heartbeat";
import { ERROR_CODES, MESSAGE_TYPES, type Envelope, type QueryName } from "./protocol";

// allow: SIZE_OK — task scope keeps the dispatcher's complete behavior matrix in this test file.
const FIXED_TIME = "2026-08-10T12:00:00.000Z";
const RAW_KEY_MATERIAL = "sk-ant-api03-abcdefghijklmnop";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface Fixture {
  deps: CommandDeps;
  sender: CommandSender;
  sent: Envelope[];
  upgradeCalls: string[];
  restartAiDevCalls: string[];
  restartServices: string[];
  upserts: Array<[string, string]>;
  queryReads: string[];
  registry: ProviderKeysFile;
  keyAdds: Array<{ provider: string; value: string; note: string }>;
  setActiveCalls: Array<[string, string | null]>;
  deleteCalls: Array<[string, string]>;
  noteUpdates: Array<[string, string, string]>;
  authApplies: Array<[string, string]>;
  authRemovals: string[];
  idleWaits: string[];
  gracefulRestarts: string[];
  setUpgradeRunning: (running: boolean) => void;
  cacheClears: () => number;
}

const STATUS_REPORT: StatusReport = {
  container_status: "running",
  uptime_seconds: 120,
  containers: {
    "ai-dev": { status: "running", uptime_seconds: 120, version: "1.2.3" },
    "ai-admin": { status: "running", uptime_seconds: 8450, version: "1.2.3" },
  },
  versions: { "AI-EngKit": "1.2.3" },
  gh_auth: "authenticated",
  glab_auth: "not authenticated",
  admin_version: "1.2.3",
  admin_version_mismatch: false,
  upgrade_state: "idle",
  upgrade_available: false,
  latest_version: "",
};

function commandEnvelope(id: string, payload: unknown): Envelope {
  return {
    type: MESSAGE_TYPES.command,
    payload,
    id,
    timestamp: FIXED_TIME,
  };
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {
    throw new Error("Deferred promise was not initialized");
  };
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function flushAsyncWork(): Promise<void> {
  // Key-command chains run 4+ awaits deep (auth-store read, apply, idle wait,
  // restart); flush enough microtask turns to drain the deepest chain.
  for (let turn = 0; turn < 16; turn += 1) {
    await Promise.resolve();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Expected query result payload to be a record");
  return value;
}

function expectSingleQueryResult(sent: Envelope[], id: string): unknown {
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: MESSAGE_TYPES.result, id });
  expect(sent.some((env) => env.type === MESSAGE_TYPES.ack)).toBe(false);
  return sent[0]?.payload;
}

function createFixture(overrides: Partial<CommandDeps> = {}): Fixture {
  let upgradeRunning = false;
  let cacheClearsCount = 0;
  let keySequence = 1;
  const sent: Envelope[] = [];
  const upgradeCalls: string[] = [];
  const restartAiDevCalls: string[] = [];
  const restartServices: string[] = [];
  const upserts: Array<[string, string]> = [];
  const queryReads: string[] = [];
  const registry: ProviderKeysFile = { providers: {} };
  const keyAdds: Array<{ provider: string; value: string; note: string }> = [];
  const setActiveCalls: Array<[string, string | null]> = [];
  const deleteCalls: Array<[string, string]> = [];
  const noteUpdates: Array<[string, string, string]> = [];
  const authApplies: Array<[string, string]> = [];
  const authRemovals: string[] = [];
  const idleWaits: string[] = [];
  const gracefulRestarts: string[] = [];
  const deps: CommandDeps = Object.assign(
    {
      isUpgradeRunning: () => upgradeRunning,
      runUpgrade: async () => {
        upgradeCalls.push("upgrade");
        return { success: true, message: "upgrade complete" };
      },
      restartAiDev: async () => {
        restartAiDevCalls.push("ai-dev");
        return { success: true, message: "reconfigured" };
      },
      restartContainer: async (service: string) => {
        restartServices.push(service);
        return { success: true, message: `${service} restarted` };
      },
      upsertEnvVar: (key: string, value: string) => {
        upserts.push([key, value]);
      },
      now: () => FIXED_TIME,
      isKeyProviderSupported: (provider: string) =>
        (KEY_MANAGED_PROVIDERS as readonly string[]).includes(provider),
      readProviderKeys: () => registry,
      addProviderKey: (provider: string, value: string, note = "") => {
        keyAdds.push({ provider, value, note });
        const entry = registry.providers[provider] ?? { keys: [], activeKeyId: null };
        const key: ProviderKey = { id: `k-${keySequence++}`, value, note, createdAt: FIXED_TIME };
        entry.keys.push(key);
        if (entry.activeKeyId === null) entry.activeKeyId = key.id;
        registry.providers[provider] = entry;
        return key;
      },
      setActiveProviderKey: (provider: string, keyId: string | null) => {
        setActiveCalls.push([provider, keyId]);
        const entry = registry.providers[provider];
        if (!entry || (keyId !== null && !entry.keys.some((candidate) => candidate.id === keyId))) return false;
        entry.activeKeyId = keyId;
        return true;
      },
      deleteProviderKey: (provider: string, keyId: string) => {
        deleteCalls.push([provider, keyId]);
        const entry = registry.providers[provider];
        if (!entry) return false;
        const idx = entry.keys.findIndex((candidate) => candidate.id === keyId);
        if (idx === -1) return false;
        entry.keys.splice(idx, 1);
        if (entry.activeKeyId === keyId) {
          entry.activeKeyId = entry.keys[Math.min(idx, entry.keys.length - 1)]?.id ?? null;
        }
        if (entry.keys.length === 0) delete registry.providers[provider];
        return true;
      },
      updateProviderKeyNote: (provider: string, keyId: string, note: string) => {
        noteUpdates.push([provider, keyId, note]);
        const key = registry.providers[provider]?.keys.find((candidate) => candidate.id === keyId);
        if (key === undefined) return false;
        key.note = note;
        return true;
      },
      applyActiveKey: async (provider: string, key: string) => {
        authApplies.push([provider, key]);
      },
      removeAuthKey: async (provider: string) => {
        authRemovals.push(provider);
      },
      clearProviderCache: async () => {
        cacheClearsCount += 1;
      },
      readProviderAuthSnapshot: async () => null,
      waitForIdleSessions: async (): Promise<IdleWaitOutcome> => {
        idleWaits.push("idle");
        return "idle";
      },
      gracefulRestartAiDev: async () => {
        gracefulRestarts.push("graceful");
        return { success: true, message: "ai-dev gracefully restarted" };
      },
    },
    {
      readStatus: async () => {
        queryReads.push("status");
        return STATUS_REPORT;
      },
      readEnv: () => {
        queryReads.push("env.get");
        return {};
      },
      readProjects: async () => {
        queryReads.push("projects.list");
        return {};
      },
      readProviders: async () => {
        queryReads.push("providers.list");
        return { invalid: false, error: null, providers: [] };
      },
    },
    overrides,
  );
  return {
    deps,
    sender: { send: (env) => sent.push(env) },
    sent,
    upgradeCalls,
    restartAiDevCalls,
    restartServices,
    upserts,
    queryReads,
    registry,
    keyAdds,
    setActiveCalls,
    deleteCalls,
    noteUpdates,
    authApplies,
    authRemovals,
    idleWaits,
    gracefulRestarts,
    setUpgradeRunning: (running) => {
      upgradeRunning = running;
    },
    cacheClears: () => cacheClearsCount,
  };
}

describe("command dispatcher", () => {
  test("rejects an unknown command type with the original id", () => {
    const fixture = createFixture();
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("unknown-1", { type: "delete" }));

    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]).toMatchObject({
      type: MESSAGE_TYPES.error,
      id: "unknown-1",
      payload: { code: ERROR_CODES.unknown_command, message: "Unknown command type" },
    });
    expect(fixture.queryReads).toEqual([]);
  });

  test("returns one result and no acknowledgement for a status query", async () => {
    const fixture = createFixture({ readStatus: async () => STATUS_REPORT });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("status-1", { type: "status" }));
    await flushAsyncWork();

    expect(fixture.sent).toEqual([
      expect.objectContaining({ type: "result", id: "status-1", payload: STATUS_REPORT }),
    ]);
    expect(fixture.sent.some((env) => env.type === MESSAGE_TYPES.ack)).toBe(false);
  });

  test("redacts secret environment values in an env.get result", async () => {
    const fixture = createFixture({
      readEnv: () => ({
        ADMIN_PASSWORD: "supersecret123",
        OPENCODE_SERVER_PASSWORD: "sk-ant-abc...",
        OPENCODE_PROVIDER: "{}",
        SAFE_KEY: "hello",
      }),
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("env-1", { type: "env.get" }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]).toMatchObject({
      type: "result",
      id: "env-1",
      payload: {
        env: {
          ADMIN_PASSWORD: "••••••",
          OPENCODE_SERVER_PASSWORD: "••••••",
          OPENCODE_PROVIDER: "{}",
          SAFE_KEY: "hello",
        },
        redacted: ["ADMIN_PASSWORD", "OPENCODE_SERVER_PASSWORD"],
      },
    });
    expect(JSON.stringify(fixture.sent[0]?.payload)).not.toContain("supersecret123");
    expect(JSON.stringify(fixture.sent[0]?.payload)).not.toContain("sk-ant-abc");
    expect(fixture.sent.some((env) => env.type === MESSAGE_TYPES.ack)).toBe(false);
  });

  test("returns the project overview map for a projects.list query", async () => {
    const projects = {
      alpha: {
        features: { knowledge: true, maintenance: false, openspec: true },
        remote: "https://example.com/alpha.git",
        disabled: false,
      },
    };
    const fixture = createFixture({ readProjects: async () => projects });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("projects-1", { type: "projects.list" }));
    await flushAsyncWork();

    expect(fixture.sent).toEqual([
      expect.objectContaining({ type: "result", id: "projects-1", payload: projects }),
    ]);
    expect(fixture.sent.some((env) => env.type === MESSAGE_TYPES.ack)).toBe(false);
  });

  test("strips raw provider keys from a providers.list result", async () => {
    const fixture = createFixture({
      readProviders: async () => ({
        invalid: false,
        error: null,
        providers: [{
          name: "anthropic",
          registry: {
            keys: [{ id: "key-1", value: "rawkey12345", note: "main", active: true }],
          },
        }],
      }),
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("providers-1", { type: "providers.list" }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]).toMatchObject({
      type: "result",
      id: "providers-1",
      payload: {
        providers: [{
          registry: {
            keys: [{ id: "key-1", masked: "rawk…2345", note: "main", active: true }],
          },
        }],
      },
    });
    expect(JSON.stringify(fixture.sent[0]?.payload)).not.toContain("rawkey12345");
    expect(fixture.sent.some((env) => env.type === MESSAGE_TYPES.ack)).toBe(false);
  });

  test("rejects malformed command payloads", () => {
    const malformedPayloads: unknown[] = [
      {},
      { type: "reconfigure" },
      { type: "restart" },
    ];

    for (const [index, payload] of malformedPayloads.entries()) {
      const fixture = createFixture();
      const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
      const id = `malformed-${index}`;

      dispatcher.handle(commandEnvelope(id, payload));

      expect(fixture.sent).toHaveLength(1);
      expect(fixture.sent[0]).toMatchObject({
        type: MESSAGE_TYPES.error,
        id,
        payload: { code: ERROR_CODES.malformed_command, message: "Malformed command payload" },
      });
    }
  });

  test("sends an immediate upgrade acknowledgement before the final success", async () => {
    const completion = deferred<{ success: boolean; message?: string }>();
    const fixture = createFixture({ runUpgrade: () => completion.promise });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("upgrade-1", { type: "upgrade" }));

    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "upgrade-1",
      payload: { status: "success", message: "upgrade starting" },
    });

    completion.resolve({ success: true, message: "upgrade complete" });
    await flushAsyncWork();
    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "upgrade-1",
      payload: {
        status: "success",
        message: "upgrade complete",
        started_at: FIXED_TIME,
        finished_at: FIXED_TIME,
      },
    });
  });

  test("turns a thrown upgrade into a final failure acknowledgement", async () => {
    const fixture = createFixture({
      runUpgrade: async () => {
        throw new Error("upgrade exploded");
      },
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("upgrade-failure", { type: "upgrade" }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "upgrade-failure",
      payload: { status: "failure", message: "upgrade exploded" },
    });
  });

  test("writes every reconfiguration value and restarts ai-dev", async () => {
    const fixture = createFixture();
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("reconfigure-1", {
      type: "reconfigure",
      env: { MODEL: "kimi", REGION: "us-east" },
    }));

    expect(fixture.upserts).toEqual([["MODEL", "kimi"], ["REGION", "us-east"]]);
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
    expect(fixture.sent[0]).toMatchObject({
      id: "reconfigure-1",
      payload: { status: "success", message: "reconfiguring" },
    });
    await flushAsyncWork();
    expect(fixture.sent[1]).toMatchObject({
      id: "reconfigure-1",
      payload: { status: "success", message: "reconfigured" },
    });
  });

  test("sends the restart acknowledgement before invoking each known service", async () => {
    const order: string[] = [];
    const sent: Envelope[] = [];
    const fixture = createFixture({
      restartContainer: async (service) => {
        order.push(`restart:${service}`);
        return { success: true, message: `${service} restarted` };
      },
    });
    const sender: CommandSender = {
      send: (env) => {
        sent.push(env);
        order.push(`send:${env.id}`);
      },
    };
    const dispatcher = createCommandDispatcher(sender, fixture.deps);

    for (const service of ["ai-dev", "ai-admin"]) {
      const id = `restart-${service}`;
      const offset = order.length;
      dispatcher.handle(commandEnvelope(id, { type: "restart", service }));

      expect(order.slice(offset, offset + 2)).toEqual([`send:${id}`, `restart:${service}`]);
      expect(sent.at(-1)).toMatchObject({
        id,
        payload: { status: "success", message: `restarting ${service}` },
      });
      await flushAsyncWork();
    }
  });

  test("defers while upgrading then drains three commands in FIFO order with ids intact", async () => {
    const fixture = createFixture();
    fixture.setUpgradeRunning(true);
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
    const commands = [
      commandEnvelope("queued-1", { type: "restart", service: "ai-dev" }),
      commandEnvelope("queued-2", { type: "restart", service: "ai-admin" }),
      commandEnvelope("queued-3", { type: "restart", service: "ai-dev" }),
    ];

    for (const command of commands) dispatcher.handle(command);

    expect(fixture.sent).toHaveLength(0);
    expect(fixture.restartServices).toHaveLength(0);
    expect(dispatcher.pendingCount()).toBe(3);

    fixture.setUpgradeRunning(false);
    dispatcher.drain();
    await flushAsyncWork();

    expect(dispatcher.pendingCount()).toBe(0);
    expect(fixture.restartServices).toEqual(["ai-dev", "ai-admin", "ai-dev"]);
    expect(fixture.sent.map((env) => env.id)).toEqual([
      "queued-1", "queued-2", "queued-3",
      "queued-1", "queued-2", "queued-3",
    ]);
  });

  test("defers a status query during upgrade and returns its result after draining", async () => {
    const fixture = createFixture({ readStatus: async () => STATUS_REPORT });
    fixture.setUpgradeRunning(true);
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("queued-status", { type: "status" }));

    expect(fixture.sent).toHaveLength(0);
    expect(dispatcher.pendingCount()).toBe(1);

    fixture.setUpgradeRunning(false);
    dispatcher.drain();
    await flushAsyncWork();

    expect(dispatcher.pendingCount()).toBe(0);
    expect(fixture.sent).toEqual([
      expect.objectContaining({ type: "result", id: "queued-status", payload: STATUS_REPORT }),
    ]);
  });
});

function seedKey(
  registry: ProviderKeysFile,
  provider: string,
  id: string,
  value: string,
  note = "main",
): void {
  const entry = registry.providers[provider] ?? { keys: [], activeKeyId: null };
  entry.keys.push({ id, value, note, createdAt: FIXED_TIME });
  if (entry.activeKeyId === null) entry.activeKeyId = id;
  registry.providers[provider] = entry;
}

describe("provider key commands", () => {
  test("rejects provider key commands for unsupported providers without side effects", () => {
    const unsupportedPayloads: unknown[] = [
      { type: "providers.key.add", provider: "anthropic", value: "sk-other" },
      { type: "providers.key.set-active", provider: "anthropic", keyId: "k-1" },
      { type: "providers.key.delete", provider: "anthropic", keyId: "k-1" },
      { type: "providers.key.update-note", provider: "anthropic", keyId: "k-1", note: "x" },
    ];

    for (const [index, payload] of unsupportedPayloads.entries()) {
      const fixture = createFixture();
      const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
      const id = `unsupported-${index}`;

      dispatcher.handle(commandEnvelope(id, payload));

      expect(fixture.sent).toHaveLength(1);
      expect(fixture.sent[0]).toMatchObject({
        type: MESSAGE_TYPES.error,
        id,
        payload: { code: ERROR_CODES.malformed_command, message: "Malformed command payload" },
      });
    }

    const fixture = createFixture();
    expect(fixture.keyAdds).toEqual([]);
    expect(fixture.setActiveCalls).toEqual([]);
    expect(fixture.deleteCalls).toEqual([]);
    expect(fixture.noteUpdates).toEqual([]);
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
  });

  test("rejects malformed provider key payloads without side effects", () => {
    const malformedPayloads: unknown[] = [
      { type: "providers.key.add", provider: "opencode-go" },
      { type: "providers.key.add", provider: "opencode-go", value: "" },
      { type: "providers.key.add", provider: "opencode-go", value: "  " },
      { type: "providers.key.add", provider: "opencode-go", value: "sk-1", note: 42 },
      { type: "providers.key.add", provider: "opencode-go", value: "sk-1", mode: "warp" },
      { type: "providers.key.add", provider: "", value: "sk-1" },
      { type: "providers.key.set-active", provider: "opencode-go" },
      { type: "providers.key.set-active", provider: "opencode-go", keyId: "" },
      { type: "providers.key.delete", provider: "opencode-go", keyId: 42 },
      { type: "providers.key.update-note", provider: "opencode-go", keyId: "k-1" },
      { type: "providers.key.update-note", provider: "opencode-go", keyId: "k-1", note: 42 },
    ];

    for (const [index, payload] of malformedPayloads.entries()) {
      const fixture = createFixture();
      const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
      const id = `malformed-key-${index}`;

      dispatcher.handle(commandEnvelope(id, payload));

      expect(fixture.sent).toHaveLength(1);
      expect(fixture.sent[0]).toMatchObject({
        type: MESSAGE_TYPES.error,
        id,
        payload: { code: ERROR_CODES.malformed_command, message: "Malformed command payload" },
      });
    }

    const fixture = createFixture();
    expect(fixture.keyAdds).toEqual([]);
    expect(fixture.setActiveCalls).toEqual([]);
    expect(fixture.deleteCalls).toEqual([]);
    expect(fixture.noteUpdates).toEqual([]);
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
  });

  test("adds a second key without applying or restarting", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-second", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
      note: "backup",
    }));

    expect(fixture.sent[0]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-second",
      payload: { status: "success", message: "adding provider key" },
    });
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-second",
      payload: { status: "success", message: "provider key k-1 added" },
    });
    expect(fixture.keyAdds).toEqual([
      { provider: "opencode-go", value: RAW_KEY_MATERIAL, note: "backup" },
    ]);
    expect(fixture.registry.providers["opencode-go"]?.keys).toHaveLength(2);
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("seed-1");
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
    expect(fixture.gracefulRestarts).toEqual([]);
    expect(JSON.stringify(fixture.sent)).not.toContain(RAW_KEY_MATERIAL);
  });

  test("applies and gracefully restarts when adding the provider's first key", async () => {
    const fixture = createFixture();
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-first", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
      note: "primary",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-first",
      payload: {
        status: "success",
        message: "provider key k-1 added and applied (graceful restart)",
      },
    });
    expect(fixture.authApplies).toEqual([["opencode-go", RAW_KEY_MATERIAL]]);
    expect(fixture.idleWaits).toEqual(["idle"]);
    expect(fixture.gracefulRestarts).toEqual(["graceful"]);
    expect(fixture.restartAiDevCalls).toEqual([]);
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("k-1");
    expect(JSON.stringify(fixture.sent)).not.toContain(RAW_KEY_MATERIAL);
  });

  test("force mode recreates ai-dev immediately for a first key", async () => {
    const fixture = createFixture();
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-force", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-force",
      payload: {
        status: "success",
        message: "provider key k-1 added and applied (force restart)",
      },
    });
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
    expect(fixture.gracefulRestarts).toEqual([]);
    expect(fixture.idleWaits).toEqual([]);
  });

  test("rejects a first key when the auth store already holds one", async () => {
    const fixture = createFixture({
      readProviderAuthSnapshot: async () => "sk-ant-existing",
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-collision", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-collision",
      payload: {
        status: "failure",
        message: "provider opencode-go already holds a key in the ai-dev auth store; remove it before adding a registry key",
      },
    });
    expect(fixture.keyAdds).toEqual([]);
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
    expect(JSON.stringify(fixture.sent)).not.toContain("sk-ant-existing");
  });

  test("rolls back the added key when applying the first key fails", async () => {
    const fixture = createFixture({
      applyActiveKey: async () => {
        throw new Error("auth store write failed");
      },
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-rollback", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-rollback",
      payload: { status: "failure", message: "auth store write failed" },
    });
    expect(fixture.deleteCalls).toEqual([["opencode-go", "k-1"]]);
    expect(fixture.registry.providers["opencode-go"]).toBeUndefined();
    expect(fixture.authRemovals).toEqual(["opencode-go"]);
    expect(fixture.cacheClears()).toBe(1);
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
    expect(JSON.stringify(fixture.sent)).not.toContain(RAW_KEY_MATERIAL);
  });

  test("rolls back the first key when restart throws", async () => {
    let restartCalls = 0;
    const fixture = createFixture({
      restartAiDev: async () => {
        restartCalls += 1;
        if (restartCalls === 1) throw new Error("restart crashed");
        return { success: true };
      },
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-restart-throws", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-restart-throws",
      payload: { status: "failure", message: "restart crashed" },
    });
    expect(fixture.registry.providers["opencode-go"]).toBeUndefined();
    expect(fixture.authRemovals).toEqual(["opencode-go"]);
    expect(restartCalls).toBe(2);
  });

  test("persists the selection and restarts when setting an active key", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    seedKey(fixture.registry, "opencode-go", "seed-2", "sk-ant-seed-two");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("set-active", {
      type: "providers.key.set-active",
      provider: "opencode-go",
      keyId: "seed-2",
      mode: "force",
    }));

    expect(fixture.sent[0]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "set-active",
      payload: { status: "success", message: "setting active provider key" },
    });
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "set-active",
      payload: { status: "success", message: "provider key seed-2 set active (force restart)" },
    });
    expect(fixture.setActiveCalls).toEqual([["opencode-go", "seed-2"]]);
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("seed-2");
    expect(fixture.authApplies).toEqual([["opencode-go", "sk-ant-seed-two"]]);
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
  });

  test("no-ops when the named key is already active", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("set-active-again", {
      type: "providers.key.set-active",
      provider: "opencode-go",
      keyId: "seed-1",
    }));

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[0]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "set-active-again",
      payload: { status: "success", message: "provider key already active" },
    });
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "set-active-again",
      payload: { status: "success", message: "provider key seed-1 is already active" },
    });
    expect(fixture.setActiveCalls).toEqual([]);
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
  });

  test("restores the actual auth key and registry selection when restart fails", async () => {
    let restartCalls = 0;
    const fixture = createFixture({
      readProviderAuthSnapshot: async () => "sk-runtime-before",
      restartAiDev: async () => {
        restartCalls += 1;
        return restartCalls === 1
          ? { success: false, message: "compose recreate failed" }
          : { success: true };
      },
    });
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    seedKey(fixture.registry, "opencode-go", "seed-2", "sk-ant-seed-two");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("set-active-revert", {
      type: "providers.key.set-active",
      provider: "opencode-go",
      keyId: "seed-2",
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "set-active-revert",
      payload: { status: "failure", message: "compose recreate failed" },
    });
    expect(fixture.setActiveCalls).toEqual([
      ["opencode-go", "seed-2"],
      ["opencode-go", "seed-1"],
    ]);
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("seed-1");
    expect(fixture.authApplies).toEqual([
      ["opencode-go", "sk-ant-seed-two"],
      ["opencode-go", "sk-runtime-before"],
    ]);
    expect(restartCalls).toBe(2);
  });

  test("reports incomplete rollback when restoring the actual auth key fails", async () => {
    let applyCalls = 0;
    let restartCalls = 0;
    const fixture = createFixture({
      readProviderAuthSnapshot: async () => "sk-runtime-before",
      applyActiveKey: async () => {
        applyCalls += 1;
        if (applyCalls === 2) throw new Error("restore failed");
      },
      restartAiDev: async () => {
        restartCalls += 1;
        if (restartCalls === 2) throw new Error("rollback restart threw");
        return { success: false, message: "compose recreate failed" };
      },
    });
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    seedKey(fixture.registry, "opencode-go", "seed-2", "sk-ant-seed-two");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("set-active-rollback-fails", {
      type: "providers.key.set-active",
      provider: "opencode-go",
      keyId: "seed-2",
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "set-active-rollback-fails",
      payload: {
        status: "failure",
        message: "compose recreate failed; rollback incomplete: runtime auth restore failed, rollback restart failed",
      },
    });
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("seed-1");
    expect(restartCalls).toBe(2);
  });

  test("restores an empty registry selection and absent auth key after restart failure", async () => {
    let restartCalls = 0;
    const fixture = createFixture({
      readProviderAuthSnapshot: async () => null,
      restartAiDev: async () => {
        restartCalls += 1;
        return restartCalls === 1
          ? { success: false, message: "compose recreate failed" }
          : { success: true };
      },
    });
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    const entry = fixture.registry.providers["opencode-go"];
    if (entry === undefined) throw new Error("Expected seeded provider entry");
    entry.activeKeyId = null;
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("set-active-from-empty", {
      type: "providers.key.set-active",
      provider: "opencode-go",
      keyId: "seed-1",
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBeNull();
    expect(fixture.authRemovals).toEqual(["opencode-go"]);
    expect(fixture.cacheClears()).toBe(1);
    expect(fixture.setActiveCalls).toEqual([
      ["opencode-go", "seed-1"],
      ["opencode-go", null],
    ]);
  });

  test("promotes and applies the next key when deleting the active key", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    seedKey(fixture.registry, "opencode-go", "seed-2", "sk-ant-seed-two");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("delete-active", {
      type: "providers.key.delete",
      provider: "opencode-go",
      keyId: "seed-1",
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "delete-active",
      payload: {
        status: "success",
        message: "provider key seed-1 deleted, key seed-2 promoted (force restart)",
      },
    });
    expect(fixture.deleteCalls).toEqual([["opencode-go", "seed-1"]]);
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("seed-2");
    expect(fixture.authApplies).toEqual([["opencode-go", "sk-ant-seed-two"]]);
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
  });

  test("removes the auth entry and cache when deleting the last key", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("delete-last", {
      type: "providers.key.delete",
      provider: "opencode-go",
      keyId: "seed-1",
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "delete-last",
      payload: {
        status: "success",
        message: "provider key seed-1 deleted, auth entry removed (force restart)",
      },
    });
    expect(fixture.authRemovals).toEqual(["opencode-go"]);
    expect(fixture.cacheClears()).toBe(1);
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
    expect(fixture.registry.providers["opencode-go"]).toBeUndefined();
  });

  test("deletes a non-active key without applying or restarting", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    seedKey(fixture.registry, "opencode-go", "seed-2", "sk-ant-seed-two");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("delete-inactive", {
      type: "providers.key.delete",
      provider: "opencode-go",
      keyId: "seed-2",
      mode: "force",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "delete-inactive",
      payload: { status: "success", message: "provider key seed-2 deleted" },
    });
    expect(fixture.deleteCalls).toEqual([["opencode-go", "seed-2"]]);
    expect(fixture.registry.providers["opencode-go"]?.activeKeyId).toBe("seed-1");
    expect(fixture.registry.providers["opencode-go"]?.keys).toHaveLength(1);
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
  });

  test("rejects set-active, delete, and update-note for unknown key ids", () => {
    const unknownIdPayloads: unknown[] = [
      { type: "providers.key.set-active", provider: "opencode-go", keyId: "seed-1" },
      { type: "providers.key.delete", provider: "opencode-go", keyId: "seed-1" },
      { type: "providers.key.update-note", provider: "opencode-go", keyId: "seed-1", note: "x" },
    ];

    for (const [index, payload] of unknownIdPayloads.entries()) {
      const fixture = createFixture();
      const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
      const id = `unknown-id-${index}`;

      dispatcher.handle(commandEnvelope(id, payload));

      expect(fixture.sent).toHaveLength(1);
      expect(fixture.sent[0]).toMatchObject({
        type: MESSAGE_TYPES.error,
        id,
        payload: { code: ERROR_CODES.malformed_command, message: "Malformed command payload" },
      });
    }
  });

  test("updates a key note without applying or restarting", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("update-note", {
      type: "providers.key.update-note",
      provider: "opencode-go",
      keyId: "seed-1",
      note: "rotated 2026-08",
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "update-note",
      payload: { status: "success", message: "note updated for provider key seed-1" },
    });
    expect(fixture.noteUpdates).toEqual([["opencode-go", "seed-1", "rotated 2026-08"]]);
    expect(fixture.registry.providers["opencode-go"]?.keys[0]?.note).toBe("rotated 2026-08");
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.restartAiDevCalls).toEqual([]);
    expect(fixture.gracefulRestarts).toEqual([]);
  });

  test("defers provider key commands while upgrading and drains them in FIFO order", async () => {
    const fixture = createFixture();
    seedKey(fixture.registry, "opencode-go", "seed-1", "sk-ant-seed-one");
    fixture.setUpgradeRunning(true);
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
    const commands = [
      commandEnvelope("queued-set-active", {
        type: "providers.key.set-active",
        provider: "opencode-go",
        keyId: "seed-1",
      }),
      commandEnvelope("queued-note", {
        type: "providers.key.update-note",
        provider: "opencode-go",
        keyId: "seed-1",
        note: "primary",
      }),
      commandEnvelope("queued-add", {
        type: "providers.key.add",
        provider: "opencode-go",
        value: RAW_KEY_MATERIAL,
      }),
    ];

    for (const command of commands) dispatcher.handle(command);

    expect(fixture.sent).toHaveLength(3);
    for (const id of ["queued-set-active", "queued-note", "queued-add"]) {
      expect(fixture.sent.find((env) => env.id === id)).toMatchObject({
        type: MESSAGE_TYPES.ack,
        id,
        payload: { status: "success", message: "provider key command queued until upgrade completes" },
      });
    }
    expect(dispatcher.pendingCount()).toBe(3);

    fixture.setUpgradeRunning(false);
    dispatcher.drain();
    await flushAsyncWork();

    expect(dispatcher.pendingCount()).toBe(0);
    expect(fixture.keyAdds).toEqual([{ provider: "opencode-go", value: RAW_KEY_MATERIAL, note: "" }]);
    expect(fixture.noteUpdates).toEqual([["opencode-go", "seed-1", "primary"]]);
    expect(fixture.setActiveCalls).toEqual([]);
    expect(fixture.authApplies).toEqual([]);
    expect(fixture.gracefulRestarts).toEqual([]);
    for (const id of ["queued-set-active", "queued-note", "queued-add"]) {
      const acks = fixture.sent.filter((env) => env.id === id);
      expect(acks).toHaveLength(3);
      expect(acks[0]).toMatchObject({ type: MESSAGE_TYPES.ack, id });
      expect(acks[1]).toMatchObject({ type: MESSAGE_TYPES.ack, id });
      expect(acks[2]).toMatchObject({ type: MESSAGE_TYPES.ack, id });
    }
    expect(JSON.stringify(fixture.sent)).not.toContain(RAW_KEY_MATERIAL);
  });

  test("rejects a malformed provider key command before acknowledging it during upgrade", () => {
    const fixture = createFixture();
    fixture.setUpgradeRunning(true);
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("invalid-queued-add", {
      type: "providers.key.add",
      provider: "opencode-go",
    }));

    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]).toMatchObject({
      type: MESSAGE_TYPES.error,
      id: "invalid-queued-add",
      payload: { code: ERROR_CODES.malformed_command, message: "Malformed command payload" },
    });
    expect(dispatcher.pendingCount()).toBe(0);
  });
});

describe("graceful restart", () => {
  test("returns idle immediately when the probe reports idle", async () => {
    expect(await waitForIdleSessions(async () => true, 1_000, 1, 3)).toBe("idle");
  });

  test("keeps polling while sessions are busy", async () => {
    const states = [false, true];
    let index = 0;
    const probe = async () => states[index++];

    expect(await waitForIdleSessions(probe, 1_000, 1, 3)).toBe("idle");
    expect(index).toBe(2);
  });

  test("times out when sessions stay busy past the deadline", async () => {
    expect(await waitForIdleSessions(async () => false, 5, 1, 3)).toBe("timeout");
  });

  test("gives up early when the probe is unavailable", async () => {
    expect(await waitForIdleSessions(async () => null, 60_000, 1, 3)).toBe("unavailable");
  });

  test("resets the failure counter when a probe recovers", async () => {
    const states: Array<boolean | null> = [null, null, true];
    let index = 0;
    const probe = async () => states[index++];

    expect(await waitForIdleSessions(probe, 60_000, 1, 3)).toBe("idle");
    expect(index).toBe(3);
  });

  test("falls back to a force restart after a graceful-wait timeout", async () => {
    const fixture = createFixture({
      waitForIdleSessions: async () => "timeout",
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-timeout", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-timeout",
      payload: {
        status: "success",
        message: "provider key k-1 added and applied (force restart after graceful-wait timeout)",
      },
    });
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
    expect(fixture.gracefulRestarts).toEqual([]);
  });

  test("falls back to a force restart when the control API is unavailable", async () => {
    const fixture = createFixture({
      waitForIdleSessions: async () => "unavailable",
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-unavailable", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-unavailable",
      payload: {
        status: "success",
        message: "provider key k-1 added and applied (force restart after unavailable control API)",
      },
    });
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
    expect(fixture.gracefulRestarts).toEqual([]);
  });

  test("reports a failed graceful restart and rolls back the added key", async () => {
    const fixture = createFixture({
      gracefulRestartAiDev: async () => ({ success: false, message: "graceful restart failed" }),
    });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("add-graceful-fail", {
      type: "providers.key.add",
      provider: "opencode-go",
      value: RAW_KEY_MATERIAL,
    }));
    await flushAsyncWork();

    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[1]).toMatchObject({
      type: MESSAGE_TYPES.ack,
      id: "add-graceful-fail",
      payload: { status: "failure", message: "graceful restart failed" },
    });
    expect(fixture.deleteCalls).toEqual([["opencode-go", "k-1"]]);
    expect(fixture.registry.providers["opencode-go"]).toBeUndefined();
    expect(fixture.authRemovals).toEqual(["opencode-go"]);
    expect(fixture.restartAiDevCalls).toEqual(["ai-dev"]);
  });
});

describe("query result contracts", () => {
  test("production query dependencies reuse shared read-only helpers", async () => {
    const overviews = await collectProjectOverviews(
      async (command: string) => {
        if (command.startsWith("find ")) return { exitCode: 0, stdout: "alpha\n", stderr: "" };
        if (command.includes("docs/knowledge/README.md")) {
          return { exitCode: 0, stdout: "yes\n", stderr: "" };
        }
        if (command.includes("git remote get-url origin")) {
          return { exitCode: 0, stdout: "https://example.com/alpha.git\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      "/workspace",
      "/settings.json",
      "/disabled-projects.json",
    );
    const deps = createRealCommandDeps();

    expect(typeof collectStatus).toBe("function");
    // StatusResponse pins container_status, uptime_seconds, restart_count,
    // gh_auth, glab_auth, git_user, project_count, admin_version, and admin_version_mismatch.
    expect(typeof readEnvFile).toBe("function");
    expect(typeof collectProjectOverviews).toBe("function");
    expect(typeof collectProvidersMeta).toBe("function");
    expect(overviews).toEqual([{
      name: "alpha",
      features: { knowledge: true, maintenance: false, openspec: false },
      remote: "https://example.com/alpha.git",
      disabled: false,
    }]);
    expect(deps.readEnv).toBe(readEnvFile);
    expect(deps.readProviders).toBe(collectProvidersMeta);
    expect(typeof deps.readProjects).toBe("function");
    expect(typeof deps.readStatus).toBe("function");
  });

  test("status result pins its schema and query correlation", async () => {
    const fixture = createFixture({ readStatus: async () => STATUS_REPORT });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("status-schema", { type: "status" }));
    await flushAsyncWork();

    const payload = expectSingleQueryResult(fixture.sent, "status-schema");
    expect(payload).toEqual(STATUS_REPORT);
    expect(Object.keys(requireRecord(payload)).sort()).toEqual([
      "admin_version",
      "admin_version_mismatch",
      "container_status",
      "containers",
      "gh_auth",
      "glab_auth",
      "latest_version",
      "upgrade_available",
      "upgrade_state",
      "uptime_seconds",
      "versions",
    ].sort());
  });

  test("env.get redacts every password schema key and pins its result schema", async () => {
    const passwordValues = Object.fromEntries(
      PASSWORD_KEYS.map((key) => [key, `${key}-super-secret-value-12345`]),
    );
    const source = {
      ...passwordValues,
      PROVIDER_KEY_HINT: RAW_KEY_MATERIAL,
      WORKSPACE_PATH: "/home/devuser/workspace",
      FEATURE_DISABLED: "false",
    };
    const fixture = createFixture({ readEnv: () => source });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("env-schema", { type: "env.get" }));
    await flushAsyncWork();

    const payload = requireRecord(expectSingleQueryResult(fixture.sent, "env-schema"));
    const env = requireRecord(payload["env"]);
    const serialized = JSON.stringify(payload);
    expect(Object.keys(payload).sort()).toEqual(["env", "redacted"]);
    expect(env).toMatchObject({
      WORKSPACE_PATH: "/home/devuser/workspace",
      FEATURE_DISABLED: "false",
    });
    expect(payload["redacted"]).toEqual([...PASSWORD_KEYS, "PROVIDER_KEY_HINT"]);
    for (const key of PASSWORD_KEYS) {
      const rawValue = source[key];
      expect(env[key]).not.toBe(rawValue);
      expect(serialized).not.toContain(rawValue);
    }
    expect(env["PROVIDER_KEY_HINT"]).not.toBe(RAW_KEY_MATERIAL);
    expect(serialized).not.toContain(RAW_KEY_MATERIAL);
  });

  test("projects.list pins the project overview schema and query correlation", async () => {
    const projects = {
      alpha: {
        features: { knowledge: true, maintenance: false, openspec: true },
        remote: "https://example.com/alpha.git",
        disabled: false,
      },
    };
    const fixture = createFixture({ readProjects: async () => projects });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("projects-schema", { type: "projects.list" }));
    await flushAsyncWork();

    const payload = expectSingleQueryResult(fixture.sent, "projects-schema");
    expect(payload).toEqual(projects);
    expect(Object.keys(requireRecord(payload))).toEqual(["alpha"]);
  });

  test("providers.list pins sanitized provider fields and query correlation", async () => {
    const providers = {
      invalid: false,
      error: null,
      providers: [{
        name: "anthropic",
        label: "Anthropic",
        npm: "@ai-sdk/anthropic",
        baseURL: "https://api.anthropic.com",
        hasApiKey: true,
        keyManagement: true,
        authStoreKeyPresent: true,
        virtual: false,
        registry: {
          keyCount: 1,
          activeKeyId: "key-1",
          keys: [{
            id: "key-1",
            value: RAW_KEY_MATERIAL,
            masked: "stale-mask",
            note: "main",
            active: true,
          }],
        },
      }],
    };
    const fixture = createFixture({ readProviders: async () => providers });
    const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);

    dispatcher.handle(commandEnvelope("providers-schema", { type: "providers.list" }));
    await flushAsyncWork();

    const payload = expectSingleQueryResult(fixture.sent, "providers-schema");
    expect(payload).toEqual({
      invalid: false,
      error: null,
      providers: [{
        name: "anthropic",
        label: "Anthropic",
        npm: "@ai-sdk/anthropic",
        baseURL: "https://api.anthropic.com",
        hasApiKey: true,
        keyManagement: true,
        authStoreKeyPresent: true,
        virtual: false,
        registry: {
          keyCount: 1,
          activeKeyId: "key-1",
          keys: [{ id: "key-1", masked: "sk-a…mnop", note: "main", active: true }],
        },
      }],
    });
    expect(JSON.stringify(payload)).not.toContain(RAW_KEY_MATERIAL);
  });

  const keyMaterialCases: ReadonlyArray<{
    name: string;
    query: QueryName;
    overrides: Partial<CommandDeps>;
  }> = [
    {
      name: "status",
      query: "status",
      overrides: {
        readStatus: async () => ({ ...STATUS_REPORT, versions: { Center: RAW_KEY_MATERIAL } }),
      },
    },
    {
      name: "projects.list",
      query: "projects.list",
      overrides: {
        readProjects: async () => ({
          alpha: {
            features: { knowledge: true, maintenance: false, openspec: false },
            remote: `https://example.com/alpha.git?token=${RAW_KEY_MATERIAL}`,
            disabled: false,
          },
        }),
      },
    },
    {
      name: "providers.list",
      query: "providers.list",
      overrides: {
        readProviders: async () => ({
          providers: [{
            name: "anthropic",
            registry: {
              keys: [{ id: "key-1", value: RAW_KEY_MATERIAL, note: "main", active: true }],
            },
          }],
        }),
      },
    },
  ];

  for (const keyMaterialCase of keyMaterialCases) {
    test(`${keyMaterialCase.name} result contains no raw key material`, async () => {
      const fixture = createFixture(keyMaterialCase.overrides);
      const dispatcher = createCommandDispatcher(fixture.sender, fixture.deps);
      const id = `${keyMaterialCase.name}-no-key-material`;

      dispatcher.handle(commandEnvelope(id, { type: keyMaterialCase.query }));
      await flushAsyncWork();

      const payload = expectSingleQueryResult(fixture.sent, id);
      expect(JSON.stringify(payload)).not.toContain(RAW_KEY_MATERIAL);
    });
  }
});
