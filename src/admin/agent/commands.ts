import { dockerCommand, getAiDevContainerRef, getComposeProject, getSelfContainerRef } from "../lib/docker";
import { upsertEnvVar as upsertRealEnvVar } from "../lib/env";
import { getState, runUpgrade as runRealUpgrade } from "../lib/upgrade";
import { buildAck, buildError, ERROR_CODES, parseCommandName, type Envelope } from "./protocol";
import { createDeferralQueue } from "./queue";

/** Runtime operations used to execute commands and report their timing. */
export interface CommandDeps {
  isUpgradeRunning: () => boolean;
  runUpgrade: () => Promise<{ success: boolean; error?: string; message?: string }>;
  restartAiDev: () => Promise<{ success: boolean; message?: string }>;
  restartContainer: (service: string) => Promise<{ success: boolean; message?: string }>;
  upsertEnvVar: (key: string, value: string) => void;
  now: () => string;
}

/** Transport boundary for protocol envelopes emitted by the dispatcher. */
export interface CommandSender {
  send: (env: Envelope) => void;
}

/** Command routing and FIFO deferral operations exposed to the agent client. */
export interface CommandDispatcher {
  handle: (env: Envelope) => void;
  defer: (env: Envelope) => void;
  drain: (limit?: number) => void;
  pendingCount: () => number;
}

type RestartService = "ai-dev" | "ai-admin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function parseReconfigureEnv(payload: unknown): Record<string, string> | null {
  if (!isRecord(payload)) return null;
  const env = payload["env"];
  return isStringRecord(env) ? env : null;
}

function parseRestartService(payload: unknown): RestartService | null {
  if (!isRecord(payload)) return null;
  const service = payload["service"];
  return service === "ai-dev" || service === "ai-admin" ? service : null;
}

/** Create a dispatcher that validates, defers, and asynchronously executes commands. */
export function createCommandDispatcher(sender: CommandSender, deps: CommandDeps): CommandDispatcher {
  const queue = createDeferralQueue<Envelope>();

  function sendMalformed(env: Envelope): void {
    sender.send(buildError(ERROR_CODES.malformed_command, "Malformed command payload", env.id));
  }

  function dispatchUpgrade(env: Envelope): void {
    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: "upgrade starting",
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    void finishUpgrade(env, startedAt);
  }

  async function finishUpgrade(env: Envelope, startedAt: string): Promise<void> {
    try {
      const result = await deps.runUpgrade();
      sender.send(buildAck(env.id, {
        status: result.success ? "success" : "failure",
        message: result.error ?? result.message ?? "upgrade done",
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    } catch (error: unknown) {
      sender.send(buildAck(env.id, {
        status: "failure",
        message: error instanceof Error ? error.message : String(error),
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    }
  }

  function dispatchReconfigure(env: Envelope, values: Record<string, string>): void {
    for (const [key, value] of Object.entries(values)) deps.upsertEnvVar(key, value);

    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: "reconfiguring",
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    void finishReconfigure(env, startedAt);
  }

  async function finishReconfigure(env: Envelope, startedAt: string): Promise<void> {
    try {
      const result = await deps.restartAiDev();
      sender.send(buildAck(env.id, {
        status: result.success ? "success" : "failure",
        message: result.message ?? "reconfiguration done",
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    } catch (error: unknown) {
      sender.send(buildAck(env.id, {
        status: "failure",
        message: error instanceof Error ? error.message : String(error),
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    }
  }

  function dispatchRestart(env: Envelope, service: RestartService): void {
    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: `restarting ${service}`,
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    void finishRestart(env, service, startedAt);
  }

  async function finishRestart(env: Envelope, service: RestartService, startedAt: string): Promise<void> {
    try {
      const result = await deps.restartContainer(service);
      sender.send(buildAck(env.id, {
        status: result.success ? "success" : "failure",
        message: result.message ?? `${service} restart done`,
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    } catch (error: unknown) {
      sender.send(buildAck(env.id, {
        status: "failure",
        message: error instanceof Error ? error.message : String(error),
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    }
  }

  function defer(env: Envelope): void {
    queue.push(env);
  }

  function handle(env: Envelope): void {
    const command = parseCommandName(env.payload);
    if (command === null) {
      const code = isRecord(env.payload) && typeof env.payload["type"] === "string"
        ? ERROR_CODES.unknown_command
        : ERROR_CODES.malformed_command;
      const message = code === ERROR_CODES.unknown_command
        ? "Unknown command type"
        : "Malformed command payload";
      sender.send(buildError(code, message, env.id));
      return;
    }

    if (deps.isUpgradeRunning()) {
      defer(env);
      return;
    }

    switch (command) {
      case "upgrade":
        dispatchUpgrade(env);
        return;
      case "reconfigure": {
        const values = parseReconfigureEnv(env.payload);
        if (values === null) {
          sendMalformed(env);
          return;
        }
        dispatchReconfigure(env, values);
        return;
      }
      case "restart": {
        const service = parseRestartService(env.payload);
        if (service === null) {
          sendMalformed(env);
          return;
        }
        dispatchRestart(env, service);
        return;
      }
    }
  }

  function drain(limit = 10): void {
    let processed = 0;
    while (queue.size() > 0 && !deps.isUpgradeRunning() && processed < limit) {
      const env = queue.shift();
      if (env === undefined) return;
      handle(env);
      processed += 1;
    }
  }

  return {
    handle,
    defer,
    drain,
    pendingCount: queue.size,
  };
}

/** Create production command dependencies backed by upgrade, env, and Docker helpers. */
export function createRealCommandDeps(): CommandDeps {
  return {
    isUpgradeRunning: () => getState() === "running",
    runUpgrade: async () => {
      try {
        const success = await runRealUpgrade();
        return success ? { success } : { success, error: "Upgrade failed" };
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    restartAiDev: async () => {
      try {
        const containerName = await getAiDevContainerRef();
        const project = await getComposeProject();
        const recreate = await dockerCommand(
          `compose -p ${project} up -d --force-recreate --no-deps ai-engkit`,
          180_000,
        );
        if (recreate.exitCode !== 0) {
          return { success: false, message: recreate.stderr || recreate.stdout || "Compose recreate failed" };
        }

        const remove = await dockerCommand(`rm -f ${containerName}`, 30_000);
        if (remove.exitCode !== 0) {
          return { success: false, message: remove.stderr || remove.stdout || "Failed to remove stale container" };
        }
        return { success: true };
      } catch (error: unknown) {
        return { success: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    restartContainer: async (service) => {
      try {
        let containerName: string;
        switch (service) {
          case "ai-dev":
            containerName = await getAiDevContainerRef();
            break;
          case "ai-admin":
            containerName = await getSelfContainerRef();
            break;
          default:
            return { success: false, message: `Unknown service: ${service}` };
        }

        const result = await dockerCommand(`restart ${containerName}`, 30_000);
        return result.exitCode === 0
          ? { success: true }
          : { success: false, message: result.stderr || result.stdout || `Failed to restart ${service}` };
      } catch (error: unknown) {
        return { success: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    upsertEnvVar: upsertRealEnvVar,
    now: () => new Date().toISOString(),
  };
}
