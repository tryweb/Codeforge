import { collectStatus } from "../lib/status";
import type { StatusResponse } from "../lib/status";
import { getState } from "../lib/upgrade";
import { resolveAgentId, redactTokenForLogging, resolveRegistrationToken } from "./auth";
import { createBackoff } from "./backoff";
import {
  createCommandDispatcher,
  createRealCommandDeps,
  type CommandDeps,
  type CommandDispatcher,
  type CommandSender,
} from "./commands";
import {
  buildStatusReport,
  getComponentVersions,
  heartbeatIntervalMs,
} from "./heartbeat";
import {
  buildError,
  buildHeartbeat,
  buildHello,
  ERROR_CODES,
  isHelloAck,
  MESSAGE_TYPES,
  parseEnvelope,
  type Envelope,
} from "./protocol";
import { readTlsFiles, resolveTlsConfig } from "./tls";

// allow: SIZE_OK — the required single-file WebSocket lifecycle is one cohesive state machine.
interface AgentWebSocketTlsOptions {
  ca: string;
  cert: string;
  key: string;
}

interface AgentWebSocketOptions {
  perMessageDeflate?: boolean;
  tls?: AgentWebSocketTlsOptions;
}

interface AgentWebSocket {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: (data: string) => void;
  close: () => void;
}

type AgentWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: AgentWebSocketOptions,
) => AgentWebSocket;

/** Current lifecycle state of the outbound agent connection. */
export type AgentConnectionState = "disabled" | "connected" | "disconnected";

/** Public controls and status for the outbound agent connection. */
export interface AgentRuntime {
  start: (opts?: { centerUrl?: string; env?: Record<string, string | undefined> }) => void;
  stop: () => void;
  getState: () => AgentConnectionState;
  getLastError: () => string | null;
}

/** Injectable dependencies used by the outbound agent runtime. */
export interface AgentRuntimeDeps {
  WebSocketCtor: AgentWebSocketConstructor;
  collectStatus: () => Promise<StatusResponse>;
  getVersions: () => Promise<Record<string, string>>;
  getUpgradeState: () => string;
  createDispatcher: (sender: CommandSender, deps: CommandDeps) => CommandDispatcher;
  createRealDeps: () => CommandDeps;
  heartbeatMs: () => number;
  logger: (level: string, msg: string) => void;
}

const DEFAULT_DEPS: AgentRuntimeDeps = {
  WebSocketCtor: WebSocket,
  collectStatus,
  getVersions: getComponentVersions,
  getUpgradeState: getState,
  createDispatcher: createCommandDispatcher,
  createRealDeps: createRealCommandDeps,
  heartbeatMs: heartbeatIntervalMs,
  logger: (_level, message) => console.log(message),
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string") return message;
  }
  return String(error);
}

/** Create an outbound agent runtime with optional dependency overrides. */
export function createAgentRuntime(overrides: Partial<AgentRuntimeDeps> = {}): AgentRuntime {
  const deps: AgentRuntimeDeps = { ...DEFAULT_DEPS, ...overrides };
  const backoff = createBackoff();
  const pendingHeartbeatIds = new Set<string>();
  let state: AgentConnectionState = "disabled";
  let lastError: string | null = null;
  let active = false;
  let connecting = false;
  let socket: AgentWebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let configuredCenterUrl: string | null = null;
  let configuredEnv: Record<string, string | undefined> = process.env;
  let logToken: string | null = null;

  const log = (level: string, message: string): void => {
    deps.logger(level, message);
  };

  const redactError = (message: string, token: string | null): string => {
    return token === null ? message : message.replaceAll(token, redactTokenForLogging(token));
  };

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    pendingHeartbeatIds.clear();
  };

  const sendEnvelope = (target: AgentWebSocket, env: Envelope): boolean => {
    try {
      target.send(JSON.stringify(env));
      return true;
    } catch (error: unknown) {
      log("warn", `Agent: send failed: ${redactError(errorMessage(error), logToken)}`);
      return false;
    }
  };

  const scheduleReconnect = (): void => {
    if (!active || reconnectTimer !== null) return;
    const delay = backoff.nextDelayMs();
    log("info", `Agent: reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const disconnect = (target: AgentWebSocket, message: string): void => {
    if (socket !== target) return;
    socket = null;
    connecting = false;
    clearHeartbeat();
    state = "disconnected";
    log("warn", message);
    scheduleReconnect();
  };

  const disconnectAndClose = (target: AgentWebSocket, message: string): void => {
    disconnect(target, message);
    try {
      target.close();
    } catch (error: unknown) {
      log("warn", `Agent: close failed: ${redactError(errorMessage(error), logToken)}`);
    }
  };

  const sendHeartbeat = async (target: AgentWebSocket): Promise<void> => {
    try {
      const report = await buildStatusReport(
        { collectStatus: deps.collectStatus, getVersions: deps.getVersions },
        deps.getUpgradeState(),
      );
      if (!active || socket !== target) return;
      const heartbeat = buildHeartbeat(report);
      if (!sendEnvelope(target, heartbeat)) return;
      pendingHeartbeatIds.add(heartbeat.id);
      if (pendingHeartbeatIds.size > 100) {
        const oldest = pendingHeartbeatIds.values().next();
        if (!oldest.done) pendingHeartbeatIds.delete(oldest.value);
      }
    } catch (error: unknown) {
      log("warn", `Agent: heartbeat failed: ${redactError(errorMessage(error), logToken)}`);
    }
  };

  const startHeartbeat = (target: AgentWebSocket): void => {
    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
      void sendHeartbeat(target);
    }, deps.heartbeatMs());
  };

  const handleAcknowledgement = (env: Envelope): void => {
    if (!pendingHeartbeatIds.has(env.id)) return;
    pendingHeartbeatIds.delete(env.id);
    const outcome = env.type === MESSAGE_TYPES.ack ? "acked" : "errored";
    log(env.type === MESSAGE_TYPES.ack ? "info" : "warn", `Agent: heartbeat ${env.id} ${outcome}`);
  };

  const connect = async (): Promise<void> => {
    const centerUrl = configuredCenterUrl;
    if (!active || connecting || socket !== null || centerUrl === null) return;
    connecting = true;
    let registrationToken: string | null = null;
    let attemptSocket: AgentWebSocket | null = null;

    try {
      registrationToken = resolveRegistrationToken(centerUrl, configuredEnv);
      logToken = registrationToken;
      const url = new URL(centerUrl);
      if (registrationToken !== null) url.searchParams.set("token", registrationToken);
      const redactedUrl = new URL(url);
      if (registrationToken !== null) {
        redactedUrl.searchParams.set("token", redactTokenForLogging(registrationToken));
      }

      const tlsConfig = resolveTlsConfig(configuredEnv);
      if (tlsConfig.configured) {
        const tls = await readTlsFiles(tlsConfig);
        if (tls.ca === null || tls.clientCert === null || tls.clientKey === null) {
          throw new TypeError("Configured TLS files could not be read");
        }
        if (!active) {
          connecting = false;
          return;
        }
        attemptSocket = new deps.WebSocketCtor(url.toString(), undefined, {
          tls: { ca: tls.ca, cert: tls.clientCert, key: tls.clientKey },
        });
      } else {
        attemptSocket = new deps.WebSocketCtor(url.toString());
      }

      const target = attemptSocket;
      socket = target;
      const dispatcher = deps.createDispatcher(
        { send: (env) => { sendEnvelope(target, env); } },
        deps.createRealDeps(),
      );
      let handshakeComplete = false;

      target.onopen = (): void => {
        if (!active || socket !== target) return;
        connecting = false;
        state = "connected";
        log("info", `Agent: connected to ${redactedUrl.toString()}`);
        sendEnvelope(target, buildHello(resolveAgentId(configuredEnv)));
      };

      target.onmessage = (event): void => {
        if (!active || socket !== target) return;
        const env = typeof event.data === "string" ? parseEnvelope(event.data) : null;
        if (env === null) {
          log("warn", "Agent: malformed message from center");
          sendEnvelope(target, buildError(ERROR_CODES.malformed_message, "Malformed JSON", "unknown"));
          if (!handshakeComplete) {
            disconnectAndClose(target, "Agent: disconnected before hello_ack");
          }
          return;
        }

        if (!handshakeComplete) {
          if (isHelloAck(env)) {
            handshakeComplete = true;
            backoff.reset();
            log("info", "Agent: handshake complete");
            startHeartbeat(target);
          } else {
            disconnectAndClose(target, "Agent: disconnected before hello_ack");
          }
          return;
        }

        switch (env.type) {
          case MESSAGE_TYPES.command:
            dispatcher.handle(env);
            return;
          case MESSAGE_TYPES.ack:
          case MESSAGE_TYPES.error:
            handleAcknowledgement(env);
            return;
          case MESSAGE_TYPES.hello_ack:
            log("info", "Agent: duplicate hello_ack ignored");
            return;
          default:
            log("warn", `Agent: unknown message type ${env.type} ignored`);
        }
      };

      target.onerror = (event): void => {
        if (!active || socket !== target) return;
        lastError = redactError(errorMessage(event), registrationToken);
        disconnectAndClose(target, `Agent: disconnected after WebSocket error: ${lastError}`);
      };

      target.onclose = (): void => {
        disconnect(target, "Agent: disconnected from center");
      };
    } catch (error: unknown) {
      if (socket === attemptSocket) socket = null;
      if (attemptSocket !== null) {
        try {
          attemptSocket.close();
        } catch (closeError: unknown) {
          log("warn", `Agent: close failed: ${redactError(errorMessage(closeError), logToken)}`);
        }
      }
      connecting = false;
      state = "disconnected";
      log("warn", `Agent: connection failed: ${redactError(errorMessage(error), registrationToken)}`);
      scheduleReconnect();
    }
  };

  return {
    start: (opts = {}): void => {
      const env = opts.env ?? process.env;
      const centerUrl = opts.centerUrl ?? env["CENTER_URL"] ?? process.env["CENTER_URL"];
      if (centerUrl === undefined || centerUrl.trim() === "") {
        state = "disabled";
        log("info", "Agent: CENTER_URL not set, agent mode disabled");
        return;
      }
      configuredCenterUrl = centerUrl;
      configuredEnv = env;
      active = true;
      state = "disconnected";
      void connect();
    },
    stop: (): void => {
      active = false;
      connecting = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearHeartbeat();
      const currentSocket = socket;
      socket = null;
      if (currentSocket !== null) {
        try {
          currentSocket.close();
        } catch (error: unknown) {
          log("warn", `Agent: close failed: ${redactError(errorMessage(error), logToken)}`);
        }
      }
    },
    getState: (): AgentConnectionState => state,
    getLastError: (): string | null => lastError,
  };
}
