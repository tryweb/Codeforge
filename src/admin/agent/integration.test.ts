import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StatusResponse } from "../lib/status";
import type { UpgradeEvent } from "../lib/upgrade";
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeDeps } from "./client";
import type { StatusReport } from "./heartbeat";
import { buildHelloAck, MESSAGE_TYPES, parseEnvelope, type Envelope } from "./protocol";

interface StubSocketData {
  readonly messages: Envelope[];
}

interface StubConnection {
  readonly messages: Envelope[];
  readonly send: (envelope: Envelope) => void;
  readonly close: () => void;
}

interface UpgradeEventSource {
  readonly subscribe: (subscriber: (event: UpgradeEvent) => void) => () => void;
  readonly emit: (event: UpgradeEvent) => void;
  readonly activeCount: () => number;
}

const STATUS: StatusResponse = {
  container_status: "running",
  uptime_seconds: 42,
  restart_count: 0,
  gh_auth: "authenticated",
  glab_auth: "not authenticated",
  git_user: "Integration Agent",
  project_count: 2,
  admin_version: "1.2.3",
  admin_version_mismatch: false,
};

const VERSIONS = { "AI-EngKit": "1.2.3" };
const STATUS_REPORT: StatusReport = {
  container_status: STATUS.container_status,
  uptime_seconds: STATUS.uptime_seconds,
  versions: VERSIONS,
  gh_auth: STATUS.gh_auth,
  glab_auth: STATUS.glab_auth,
  admin_version: STATUS.admin_version,
  admin_version_mismatch: STATUS.admin_version_mismatch,
  upgrade_state: "idle",
};
const STATUS_FIELDS = [
  "admin_version",
  "admin_version_mismatch",
  "container_status",
  "gh_auth",
  "glab_auth",
  "uptime_seconds",
  "upgrade_state",
  "versions",
] as const;

const connections: StubConnection[] = [];
const acknowledgedIds = new Set<string>();
const runtimes: AgentRuntime[] = [];
let closedConnections = 0;
let centerUrl = "";
let originalCenterUrl: string | undefined;
let stopServer: (() => void) | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} is not an object`);
  return value;
}

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new RangeError(`Timed out waiting for ${description}`);
    await Bun.sleep(10);
  }
}

async function waitForConnection(index: number, timeoutMs = 5_000): Promise<StubConnection> {
  await waitUntil(() => connections[index] !== undefined, `stub connection ${index}`, timeoutMs);
  const connection = connections[index];
  if (connection === undefined) throw new RangeError(`Missing stub connection ${index}`);
  return connection;
}

async function waitForEnvelope(
  connection: StubConnection,
  predicate: (envelope: Envelope) => boolean,
  timeoutMs = 5_000,
): Promise<Envelope> {
  let found: Envelope | undefined;
  await waitUntil(() => {
    found = connection.messages.find(predicate);
    return found !== undefined;
  }, "matching WebSocket envelope", timeoutMs);
  if (found === undefined) throw new RangeError("Missing matching WebSocket envelope");
  return found;
}

function createUpgradeEventSource(): UpgradeEventSource {
  let subscribers: ((event: UpgradeEvent) => void)[] = [];
  return {
    subscribe: (subscriber) => {
      subscribers.push(subscriber);
      return () => {
        subscribers = subscribers.filter((candidate) => candidate !== subscriber);
      };
    },
    emit: (event) => {
      for (const subscriber of subscribers) subscriber(event);
    },
    activeCount: () => subscribers.length,
  };
}

function createIntegrationRuntime(
  logs: string[],
  overrides: Partial<AgentRuntimeDeps> = {},
): AgentRuntime {
  const runtime = createAgentRuntime({
    collectStatus: async () => STATUS,
    getVersions: async () => VERSIONS,
    getUpgradeState: () => "idle",
    createRealDeps: () => ({
      isUpgradeRunning: () => false,
      runUpgrade: async () => ({ success: true }),
      restartAiDev: async () => ({ success: true }),
      restartContainer: async () => ({ success: true }),
      upsertEnvVar: () => undefined,
      now: () => "2026-08-10T00:00:00.000Z",
      readStatus: async () => STATUS_REPORT,
      readEnv: () => ({}),
      readProjects: async () => ({}),
      readProviders: async () => ({}),
    }),
    heartbeatMs: () => 25,
    logger: (level, message) => logs.push(`${level}:${message}`),
    ...overrides,
  });
  runtimes.push(runtime);
  return runtime;
}

beforeAll(() => {
  originalCenterUrl = process.env["CENTER_URL"];
  const server = Bun.serve<StubSocketData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, bunServer) {
      if (bunServer.upgrade(request, { data: { messages: [] } })) return;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
    websocket: {
      open(socket) {
        connections.push({
          messages: socket.data.messages,
          send: (envelope) => {
            socket.send(JSON.stringify(envelope));
          },
          close: () => {
            socket.close();
          },
        });
      },
      message(socket, message) {
        const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
        const envelope = parseEnvelope(raw);
        if (envelope === null) return;
        socket.data.messages.push(envelope);
        if (envelope.type === MESSAGE_TYPES.ack) acknowledgedIds.add(envelope.id);
        if (socket.data.messages.length === 1 && envelope.type === MESSAGE_TYPES.hello) {
          socket.send(JSON.stringify(buildHelloAck(envelope.id)));
        }
      },
      close() {
        closedConnections += 1;
      },
    },
  });
  centerUrl = `ws://127.0.0.1:${server.port}/ws?token=test-token`;
  process.env["CENTER_URL"] = centerUrl;
  stopServer = () => {
    void server.stop(true);
  };
});

afterAll(() => {
  for (const runtime of runtimes) runtime.stop();
  if (stopServer !== null) stopServer();
  if (originalCenterUrl === undefined) {
    delete process.env["CENTER_URL"];
  } else {
    process.env["CENTER_URL"] = originalCenterUrl;
  }
});

describe("agent stub-center integration", () => {
  it("round-trips hello v1, heartbeat, and a status query without an ack", async () => {
    const connectionIndex = connections.length;
    const logs: string[] = [];
    const runtime = createIntegrationRuntime(logs);
    runtime.start({ env: { CENTER_URL: centerUrl } });
    const connection = await waitForConnection(connectionIndex);

    const hello = await waitForEnvelope(connection, (envelope) => envelope.type === MESSAGE_TYPES.hello);
    expect(connection.messages[0]).toEqual(hello);
    const helloPayload = requireRecord(hello.payload, "hello payload");
    expect(typeof helloPayload["agent_id"]).toBe("string");
    expect(helloPayload["agent_id"]).not.toBe("");
    expect(helloPayload["protocol_version"]).toBe(1);

    const heartbeat = await waitForEnvelope(connection, (envelope) => envelope.type === MESSAGE_TYPES.heartbeat);
    expect(heartbeat.payload).toMatchObject({
      container_status: "running",
      uptime_seconds: 42,
      versions: VERSIONS,
      upgrade_state: "idle",
    });

    connection.send({
      type: MESSAGE_TYPES.command,
      id: "q1",
      payload: { type: "status" },
      timestamp: new Date().toISOString(),
    });
    const result = await waitForEnvelope(
      connection,
      (envelope) => envelope.type === MESSAGE_TYPES.result && envelope.id === "q1",
    );
    const resultPayload = requireRecord(result.payload, "status result payload");
    expect(Object.keys(resultPayload).sort()).toEqual([...STATUS_FIELDS].sort());
    expect(acknowledgedIds.has("q1")).toBe(false);
    expect(logs.some((line) => line.includes("handshake complete"))).toBe(true);

    runtime.stop();
  }, 10_000);

  it("streams ordered upgrade events and restores one subscription after reconnect", async () => {
    const source = createUpgradeEventSource();
    const connectionIndex = connections.length;
    const runtime = createIntegrationRuntime([], { subscribeUpgrade: source.subscribe });
    runtime.start({ env: { CENTER_URL: centerUrl } });
    const first = await waitForConnection(connectionIndex);
    await waitUntil(() => source.activeCount() === 1, "initial upgrade subscription");

    const events: UpgradeEvent[] = [
      { id: 1, step: "backup", status: "running", message: "A", timestamp: "2026-08-10T00:00:00.000Z" },
      { id: 2, step: "merge_env", status: "running", message: "B", timestamp: "2026-08-10T00:00:01.000Z" },
      { id: 3, step: "recreate", status: "running", message: "C", timestamp: "2026-08-10T00:00:02.000Z" },
    ];
    for (const event of events) source.emit(event);
    await waitUntil(
      () => first.messages.filter((envelope) => envelope.type === MESSAGE_TYPES.event).length === 3,
      "three upgrade event envelopes",
    );

    const received = first.messages.filter((envelope) => envelope.type === MESSAGE_TYPES.event);
    expect(received.map((envelope) => requireRecord(envelope.payload, "event payload")["name"])).toEqual([
      "upgrade",
      "upgrade",
      "upgrade",
    ]);
    expect(received.map((envelope) => {
      const payload = requireRecord(envelope.payload, "event payload");
      return requireRecord(payload["data"], "event data")["step"];
    })).toEqual(["backup", "merge_env", "recreate"]);
    expect(new Set(received.map((envelope) => envelope.id)).size).toBe(3);

    const closedBeforeReconnect = closedConnections;
    first.close();
    await waitUntil(() => closedConnections > closedBeforeReconnect, "server-side WebSocket close");
    await waitUntil(() => source.activeCount() === 0, "upgrade subscription detach");
    const second = await waitForConnection(connectionIndex + 1, 4_000);
    await waitUntil(() => source.activeCount() === 1, "reconnected upgrade subscription", 4_000);
    expect(source.activeCount()).toBe(1);

    source.emit({
      id: 4,
      step: "poll_health",
      status: "running",
      message: "After reconnect",
      timestamp: "2026-08-10T00:00:03.000Z",
    });
    await waitUntil(
      () => second.messages.filter((envelope) => envelope.type === MESSAGE_TYPES.event).length === 1,
      "one post-reconnect event",
    );

    runtime.stop();
  }, 10_000);
});
