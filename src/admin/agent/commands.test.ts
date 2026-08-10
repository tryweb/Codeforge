import { describe, expect, test } from "bun:test";
import type { CommandDeps, CommandSender } from "./commands";
import { createCommandDispatcher } from "./commands";
import { ERROR_CODES, MESSAGE_TYPES, type Envelope } from "./protocol";

const FIXED_TIME = "2026-08-10T12:00:00.000Z";

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
  setUpgradeRunning: (running: boolean) => void;
}

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

function createFixture(overrides: Partial<CommandDeps> = {}): Fixture {
  let upgradeRunning = false;
  const sent: Envelope[] = [];
  const upgradeCalls: string[] = [];
  const restartAiDevCalls: string[] = [];
  const restartServices: string[] = [];
  const upserts: Array<[string, string]> = [];
  const deps: CommandDeps = {
    isUpgradeRunning: () => upgradeRunning,
    runUpgrade: async () => {
      upgradeCalls.push("upgrade");
      return { success: true, message: "upgrade complete" };
    },
    restartAiDev: async () => {
      restartAiDevCalls.push("ai-dev");
      return { success: true, message: "reconfigured" };
    },
    restartContainer: async (service) => {
      restartServices.push(service);
      return { success: true, message: `${service} restarted` };
    },
    upsertEnvVar: (key, value) => {
      upserts.push([key, value]);
    },
    now: () => FIXED_TIME,
    ...overrides,
  };
  return {
    deps,
    sender: { send: (env) => sent.push(env) },
    sent,
    upgradeCalls,
    restartAiDevCalls,
    restartServices,
    upserts,
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
});
