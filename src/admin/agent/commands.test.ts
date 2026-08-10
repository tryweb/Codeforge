import { describe, expect, test } from "bun:test";
import { PASSWORD_KEYS } from "../lib/env-schema";
import { readEnvFile } from "../lib/env";
import { collectProjectOverviews } from "../lib/projects-overview";
import { collectProvidersMeta } from "../lib/provider-meta";
import { collectStatus } from "../lib/status";
import type { CommandDeps, CommandSender } from "./commands";
import { createCommandDispatcher, createRealCommandDeps } from "./commands";
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
  setUpgradeRunning: (running: boolean) => void;
}

const STATUS_REPORT: StatusReport = {
  container_status: "running",
  uptime_seconds: 120,
  versions: { "AI-EngKit": "1.2.3" },
  gh_auth: "authenticated",
  glab_auth: "not authenticated",
  admin_version: "1.2.3",
  admin_version_mismatch: false,
  upgrade_state: "idle",
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
  await Promise.resolve();
  await Promise.resolve();
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
  const sent: Envelope[] = [];
  const upgradeCalls: string[] = [];
  const restartAiDevCalls: string[] = [];
  const restartServices: string[] = [];
  const upserts: Array<[string, string]> = [];
  const queryReads: string[] = [];
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
    setUpgradeRunning: (running) => {
      upgradeRunning = running;
    },
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
      "gh_auth",
      "glab_auth",
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
