import {
  dockerCommand,
  execInAiDev,
  getAiDevContainerRef,
  getComposeProject,
  getSelfContainerRef,
} from "../lib/docker";
import { PASSWORD_KEYS } from "../lib/env-schema";
import { readEnvFile, upsertEnvVar as upsertRealEnvVar } from "../lib/env";
import { collectProjectOverviews, type ProjectFeatures } from "../lib/projects-overview";
import { collectProvidersMeta } from "../lib/provider-meta";
import {
  addProviderKey as realAddProviderKey,
  deleteProviderKey as realDeleteProviderKey,
  maskKey,
  readProviderKeys as realReadProviderKeys,
  setActiveProviderKey as realSetActiveProviderKey,
  updateProviderKeyNote as realUpdateProviderKeyNote,
  type ProviderKey,
  type ProviderKeysFile,
} from "../lib/provider-keys";
import {
  applyActiveKey as realApplyActiveKey,
  clearProviderCache as realClearProviderCache,
  isKeyProviderSupported as realIsKeyProviderSupported,
  readProviderAuthKey as realReadProviderAuthKey,
  removeAuthKey as realRemoveAuthKey,
} from "../lib/opencode-auth";
import { collectStatus } from "../lib/status";
import { getState, runUpgrade as runRealUpgrade } from "../lib/upgrade";
import { buildStatusReport, getComponentVersions, type StatusReport } from "./heartbeat";
import {
  buildAck,
  buildError,
  buildResult,
  ERROR_CODES,
  parseCommandType,
  type Envelope,
  type QueryName,
} from "./protocol";
import { createDeferralQueue } from "./queue";

// allow: SIZE_OK — this module owns one dispatcher state machine and its production dependencies.
type ProjectReadResult = Record<string, {
  features: ProjectFeatures;
  remote: string | null;
  disabled: boolean;
}>;

const DEFAULT_WORKSPACE_ROOT = "/home/devuser/workspace";
const DEFAULT_OPENCHAMBER_SETTINGS = "/home/devuser/.config/openchamber/settings.json";
const DEFAULT_OPENCHAMBER_DISABLED = "/home/devuser/.config/openchamber/disabled-projects.json";
const SECRET_MASK = "••••••";
const KEY_MATERIAL_PATTERN = /(sk-|ghp_|glpat-|AIza|token=|secret)/i;

/** Runtime operations used to execute commands and serve read-only queries. */
export interface CommandDeps {
  isUpgradeRunning: () => boolean;
  runUpgrade: () => Promise<{ success: boolean; error?: string; message?: string }>;
  restartAiDev: () => Promise<{ success: boolean; message?: string }>;
  restartContainer: (service: string) => Promise<{ success: boolean; message?: string }>;
  upsertEnvVar: (key: string, value: string) => void;
  now: () => string;
  readStatus: () => Promise<StatusReport>;
  readEnv: () => Record<string, string>;
  readProjects: () => Promise<ProjectReadResult>;
  readProviders: () => Promise<unknown>;
  isKeyProviderSupported: (provider: string) => boolean;
  readProviderKeys: () => ProviderKeysFile;
  addProviderKey: (provider: string, value: string, note?: string) => ProviderKey;
  setActiveProviderKey: (provider: string, keyId: string) => boolean;
  deleteProviderKey: (provider: string, keyId: string) => boolean;
  updateProviderKeyNote: (provider: string, keyId: string, note: string) => boolean;
  applyActiveKey: (provider: string, key: string) => Promise<void>;
  removeAuthKey: (provider: string) => Promise<void>;
  clearProviderCache: () => Promise<void>;
  readProviderAuthKey: (provider: string) => Promise<string | null>;
  waitForIdleSessions: () => Promise<IdleWaitOutcome>;
  gracefulRestartAiDev: () => Promise<{ success: boolean; message?: string }>;
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

/** Restart modes accepted by provider key commands (default: graceful). */
export type RestartMode = "graceful" | "force";

/** Outcome of a graceful idle-wait before restarting ai-dev. */
export type IdleWaitOutcome = "idle" | "timeout" | "unavailable";

interface ProviderKeyAddPayload {
  provider: string;
  value: string;
  note: string;
  mode: RestartMode;
}

interface ProviderKeyRefPayload {
  provider: string;
  keyId: string;
  mode: RestartMode;
}

interface ProviderKeyNotePayload {
  provider: string;
  keyId: string;
  note: string;
}

interface RedactedEnvironment {
  env: Record<string, string>;
  redacted: string[];
}

interface SafeProviderKey {
  id: string;
  masked: string;
  note: string;
  active: boolean;
}

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

function parseRestartMode(value: unknown): RestartMode | null {
  if (value === undefined) return "graceful";
  return value === "graceful" || value === "force" ? value : null;
}

function parseProviderKeyAdd(payload: unknown): ProviderKeyAddPayload | null {
  if (!isRecord(payload)) return null;
  const provider = payload["provider"];
  const value = payload["value"];
  if (typeof provider !== "string" || provider === "") return null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const note = payload["note"];
  if (note !== undefined && typeof note !== "string") return null;
  const mode = parseRestartMode(payload["mode"]);
  if (mode === null) return null;
  return { provider, value, note: typeof note === "string" ? note : "", mode };
}

function parseProviderKeyRef(payload: unknown): ProviderKeyRefPayload | null {
  if (!isRecord(payload)) return null;
  const provider = payload["provider"];
  const keyId = payload["keyId"];
  if (typeof provider !== "string" || provider === "") return null;
  if (typeof keyId !== "string" || keyId === "") return null;
  const mode = parseRestartMode(payload["mode"]);
  if (mode === null) return null;
  return { provider, keyId, mode };
}

function parseProviderKeyNote(payload: unknown): ProviderKeyNotePayload | null {
  if (!isRecord(payload)) return null;
  const provider = payload["provider"];
  const keyId = payload["keyId"];
  const note = payload["note"];
  if (typeof provider !== "string" || provider === "") return null;
  if (typeof keyId !== "string" || keyId === "") return null;
  if (typeof note !== "string") return null;
  return { provider, keyId, note };
}

function redactEnvironment(source: Record<string, string>): RedactedEnvironment {
  const env: Record<string, string> = {};
  const redacted: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (PASSWORD_KEYS.includes(key)) {
      env[key] = SECRET_MASK;
      redacted.push(key);
    } else if (KEY_MATERIAL_PATTERN.test(value)) {
      env[key] = maskKey(value);
      redacted.push(key);
    } else {
      env[key] = value;
    }
  }
  return { env, redacted };
}

function maskResultKeyMaterial(value: unknown): unknown {
  if (typeof value === "string") {
    return KEY_MATERIAL_PATTERN.test(value) ? maskKey(value) : value;
  }
  if (Array.isArray(value)) return value.map(maskResultKeyMaterial);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, maskResultKeyMaterial(nestedValue)]),
  );
}

function sanitizeProviderKey(value: unknown): SafeProviderKey {
  if (!isRecord(value)) return { id: "", masked: "", note: "", active: false };
  const rawValue = value["value"];
  const maskedValue = value["masked"];
  return {
    id: typeof value["id"] === "string" ? value["id"] : "",
    masked: typeof rawValue === "string"
      ? maskKey(rawValue)
      : typeof maskedValue === "string" ? maskedValue : "",
    note: typeof value["note"] === "string" ? value["note"] : "",
    active: value["active"] === true,
  };
}

function sanitizeProviders(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload["providers"])) return payload;
  return {
    ...payload,
    providers: payload["providers"].map((provider) => {
      if (!isRecord(provider) || !isRecord(provider["registry"])) return provider;
      const registry = provider["registry"];
      if (!Array.isArray(registry["keys"])) return provider;
      return {
        ...provider,
        registry: {
          ...registry,
          keys: registry["keys"].map(sanitizeProviderKey),
        },
      };
    }),
  };
}

async function readProjectOverviews(): Promise<ProjectReadResult> {
  const overviews = await collectProjectOverviews(
    execInAiDev,
    DEFAULT_WORKSPACE_ROOT,
    DEFAULT_OPENCHAMBER_SETTINGS,
    DEFAULT_OPENCHAMBER_DISABLED,
  );
  const projects: ProjectReadResult = {};
  for (const overview of overviews) {
    projects[overview.name] = {
      features: overview.features,
      remote: overview.remote,
      disabled: overview.disabled,
    };
  }
  return projects;
}

/**
 * Probe whether every live OpenChamber session on the ai-dev opencode server
 * is idle. Returns true (all idle), false (at least one session is busy), or
 * null (the opencode server API is unreachable).
 *
 * The chamber control API wraps exactly this session-status source (its
 * service.js fetches /session/:id/state), and the direct probe was verified
 * against the running container: GET /session + /session/:id/state return
 * live data while the control API's session.list returned no sessions in
 * this build.
 */
const OPENCODE_SESSION_PROBE_SCRIPT = `
PORT=$(cat "$HOME/.config/openchamber/managed-opencode/"*.json 2>/dev/null | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' | tail -1 | grep -o '[0-9]*$')
if [ -z "$PORT" ]; then
  PORT=$(pgrep -af 'opencode serve' 2>/dev/null | grep -o '\-\-port[[:space:]][0-9]*' | tail -1 | awk '{print $2}')
fi
[ -n "$PORT" ] || exit 3
SESSIONS=$(curl -fsS -m 5 "http://127.0.0.1:\${PORT}/session" 2>/dev/null) || exit 2
IDS=$(echo "$SESSIONS" | jq -r '.[].id // empty' 2>/dev/null) || exit 2
for SID in $IDS; do
  ST=$(curl -fsS -m 5 "http://127.0.0.1:\${PORT}/session/\${SID}/state" 2>/dev/null) || exit 2
  BUSY=$(echo "$ST" | jq -r '.busy // false' 2>/dev/null) || exit 2
  [ "$BUSY" = "true" ] && exit 1
done
exit 0
`;

export async function probeIdleViaOpenCodeServer(): Promise<boolean | null> {
  const result = await execInAiDev(OPENCODE_SESSION_PROBE_SCRIPT, 30_000);
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  return null;
}

/**
 * Poll the session probe until every session is idle, the deadline passes, or
 * the probe proves unavailable. Busy sessions keep waiting; repeated probe
 * failures give up early so a dead opencode server cannot block a restart
 * for the full deadline.
 */
export async function waitForIdleSessions(
  probe: () => Promise<boolean | null>,
  deadlineMs = 10 * 60_000,
  intervalMs = 15_000,
  consecutiveFailuresToGiveUp = 3,
): Promise<IdleWaitOutcome> {
  const deadline = Date.now() + deadlineMs;
  let consecutiveFailures = 0;
  while (true) {
    const idle = await probe();
    if (idle === true) return "idle";
    if (idle === null) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= consecutiveFailuresToGiveUp) return "unavailable";
    } else {
      consecutiveFailures = 0;
    }
    if (Date.now() >= deadline) return "timeout";
    await Bun.sleep(intervalMs);
  }
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

  async function restartPerMode(
    mode: RestartMode,
  ): Promise<{ success: boolean; message: string; suffix: string }> {
    if (mode === "force") {
      const result = await deps.restartAiDev();
      return { success: result.success, message: result.message ?? "ai-dev restarted", suffix: "(force restart)" };
    }

    const waitOutcome = await deps.waitForIdleSessions();
    if (waitOutcome === "idle") {
      const result = await deps.gracefulRestartAiDev();
      return {
        success: result.success,
        message: result.message ?? "ai-dev gracefully restarted",
        suffix: "(graceful restart)",
      };
    }

    const result = await deps.restartAiDev();
    const fallbackReason = waitOutcome === "timeout" ? "graceful-wait timeout" : "unavailable control API";
    return {
      success: result.success,
      message: `${result.message ?? "ai-dev restarted"} (force fallback after ${fallbackReason})`,
      suffix: `(force restart after ${fallbackReason})`,
    };
  }

  async function applyKeyAndRestart(
    provider: string,
    key: string,
    mode: RestartMode,
  ): Promise<{ success: boolean; message: string; suffix: string }> {
    try {
      await deps.applyActiveKey(provider, key);
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error), suffix: "" };
    }
    return restartPerMode(mode);
  }

  function dispatchKeyAdd(env: Envelope, payload: ProviderKeyAddPayload): void {
    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: "adding provider key",
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    void finishKeyAdd(env, payload, startedAt);
  }

  async function finishKeyAdd(env: Envelope, payload: ProviderKeyAddPayload, startedAt: string): Promise<void> {
    try {
      const existing = deps.readProviderKeys().providers[payload.provider]?.keys ?? [];
      const firstKey = existing.length === 0;
      if (firstKey) {
        const stored = await deps.readProviderAuthKey(payload.provider);
        if (stored !== null) {
          sender.send(buildAck(env.id, {
            status: "failure",
            message: `provider ${payload.provider} already holds a key in the ai-dev auth store; remove it before adding a registry key`,
            started_at: startedAt,
            finished_at: deps.now(),
          }));
          return;
        }
      }

      const added = deps.addProviderKey(payload.provider, payload.value, payload.note);
      if (!firstKey) {
        sender.send(buildAck(env.id, {
          status: "success",
          message: `provider key ${added.id} added`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }

      const applied = await applyKeyAndRestart(payload.provider, payload.value, payload.mode);
      if (!applied.success) {
        deps.deleteProviderKey(payload.provider, added.id);
        sender.send(buildAck(env.id, {
          status: "failure",
          message: applied.message,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      sender.send(buildAck(env.id, {
        status: "success",
        message: `provider key ${added.id} added and applied ${applied.suffix}`,
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

  function dispatchKeySetActive(
    env: Envelope,
    payload: ProviderKeyRefPayload,
    key: ProviderKey,
    previousActiveId: string | null,
  ): void {
    const alreadyActive = previousActiveId === payload.keyId;
    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: alreadyActive ? "provider key already active" : "setting active provider key",
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    if (alreadyActive) {
      sender.send(buildAck(env.id, {
        status: "success",
        message: `provider key ${key.id} is already active`,
        started_at: startedAt,
        finished_at: deps.now(),
      }));
      return;
    }

    void finishKeySetActive(env, payload, key, previousActiveId, startedAt);
  }

  async function finishKeySetActive(
    env: Envelope,
    payload: ProviderKeyRefPayload,
    key: ProviderKey,
    previousActiveId: string | null,
    startedAt: string,
  ): Promise<void> {
    const revert = (): void => {
      if (previousActiveId !== null) deps.setActiveProviderKey(payload.provider, previousActiveId);
    };
    try {
      if (!deps.setActiveProviderKey(payload.provider, payload.keyId)) {
        sender.send(buildAck(env.id, {
          status: "failure",
          message: `provider key ${payload.keyId} not found`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      const applied = await applyKeyAndRestart(payload.provider, key.value, payload.mode);
      if (!applied.success) {
        revert();
        sender.send(buildAck(env.id, {
          status: "failure",
          message: applied.message,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      sender.send(buildAck(env.id, {
        status: "success",
        message: `provider key ${key.id} set active ${applied.suffix}`,
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    } catch (error: unknown) {
      revert();
      sender.send(buildAck(env.id, {
        status: "failure",
        message: error instanceof Error ? error.message : String(error),
        started_at: startedAt,
        finished_at: deps.now(),
      }));
    }
  }

  function dispatchKeyDelete(env: Envelope, payload: ProviderKeyRefPayload): void {
    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: "deleting provider key",
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    void finishKeyDelete(env, payload, startedAt);
  }

  async function finishKeyDelete(env: Envelope, payload: ProviderKeyRefPayload, startedAt: string): Promise<void> {
    try {
      const entryBefore = deps.readProviderKeys().providers[payload.provider];
      const key = entryBefore?.keys.find((candidate) => candidate.id === payload.keyId);
      if (key === undefined) {
        sender.send(buildAck(env.id, {
          status: "failure",
          message: `provider key ${payload.keyId} not found`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      const wasActive = entryBefore.activeKeyId === payload.keyId;
      const remaining = (entryBefore.keys.length ?? 0) - 1;

      if (!deps.deleteProviderKey(payload.provider, payload.keyId)) {
        sender.send(buildAck(env.id, {
          status: "failure",
          message: `provider key ${payload.keyId} not found`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }

      if (!wasActive) {
        sender.send(buildAck(env.id, {
          status: "success",
          message: `provider key ${payload.keyId} deleted`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }

      if (remaining === 0) {
        await deps.removeAuthKey(payload.provider);
        await deps.clearProviderCache();
        const applied = await restartPerMode(payload.mode);
        if (!applied.success) {
          sender.send(buildAck(env.id, {
            status: "failure",
            message: applied.message,
            started_at: startedAt,
            finished_at: deps.now(),
          }));
          return;
        }
        sender.send(buildAck(env.id, {
          status: "success",
          message: `provider key ${payload.keyId} deleted, auth entry removed ${applied.suffix}`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }

      const entryAfter = deps.readProviderKeys().providers[payload.provider];
      const next = entryAfter?.keys.find((candidate) => candidate.id === entryAfter?.activeKeyId);
      if (next === undefined) {
        sender.send(buildAck(env.id, {
          status: "failure",
          message: "no replacement key to apply after deletion",
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      const applied = await applyKeyAndRestart(payload.provider, next.value, payload.mode);
      if (!applied.success) {
        sender.send(buildAck(env.id, {
          status: "failure",
          message: applied.message,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      sender.send(buildAck(env.id, {
        status: "success",
        message: `provider key ${payload.keyId} deleted, key ${next.id} promoted ${applied.suffix}`,
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

  function dispatchKeyUpdateNote(env: Envelope, payload: ProviderKeyNotePayload): void {
    const startedAt = deps.now();
    sender.send(buildAck(env.id, {
      status: "success",
      message: "updating provider key note",
      started_at: startedAt,
      finished_at: deps.now(),
    }));

    void finishKeyUpdateNote(env, payload, startedAt);
  }

  async function finishKeyUpdateNote(env: Envelope, payload: ProviderKeyNotePayload, startedAt: string): Promise<void> {
    try {
      if (!deps.updateProviderKeyNote(payload.provider, payload.keyId, payload.note)) {
        sender.send(buildAck(env.id, {
          status: "failure",
          message: `provider key ${payload.keyId} not found`,
          started_at: startedAt,
          finished_at: deps.now(),
        }));
        return;
      }
      sender.send(buildAck(env.id, {
        status: "success",
        message: `note updated for provider key ${payload.keyId}`,
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

  async function dispatchQuery(env: Envelope, query: QueryName): Promise<void> {
    let payload: unknown;
    switch (query) {
      case "status":
        payload = await deps.readStatus();
        break;
      case "env.get":
        payload = redactEnvironment(deps.readEnv());
        break;
      case "projects.list":
        payload = await deps.readProjects();
        break;
      case "providers.list":
        payload = sanitizeProviders(await deps.readProviders());
        break;
    }
    sender.send(buildResult(env.id, maskResultKeyMaterial(payload)));
  }

  function defer(env: Envelope): void {
    queue.push(env);
  }

  function handle(env: Envelope): void {
    const command = parseCommandType(env.payload);
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
      case "providers.key.add": {
        const payload = parseProviderKeyAdd(env.payload);
        if (payload === null || !deps.isKeyProviderSupported(payload.provider)) {
          sendMalformed(env);
          return;
        }
        dispatchKeyAdd(env, payload);
        return;
      }
      case "providers.key.set-active": {
        const payload = parseProviderKeyRef(env.payload);
        if (payload === null || !deps.isKeyProviderSupported(payload.provider)) {
          sendMalformed(env);
          return;
        }
        const entry = deps.readProviderKeys().providers[payload.provider];
        const key = entry?.keys.find((candidate) => candidate.id === payload.keyId);
        if (key === undefined) {
          sendMalformed(env);
          return;
        }
        dispatchKeySetActive(env, payload, key, entry?.activeKeyId ?? null);
        return;
      }
      case "providers.key.delete": {
        const payload = parseProviderKeyRef(env.payload);
        if (payload === null || !deps.isKeyProviderSupported(payload.provider)) {
          sendMalformed(env);
          return;
        }
        const entry = deps.readProviderKeys().providers[payload.provider];
        if (entry === undefined || !entry.keys.some((candidate) => candidate.id === payload.keyId)) {
          sendMalformed(env);
          return;
        }
        dispatchKeyDelete(env, payload);
        return;
      }
      case "providers.key.update-note": {
        const payload = parseProviderKeyNote(env.payload);
        if (payload === null || !deps.isKeyProviderSupported(payload.provider)) {
          sendMalformed(env);
          return;
        }
        const entry = deps.readProviderKeys().providers[payload.provider];
        if (entry === undefined || !entry.keys.some((candidate) => candidate.id === payload.keyId)) {
          sendMalformed(env);
          return;
        }
        dispatchKeyUpdateNote(env, payload);
        return;
      }
      case "status":
      case "env.get":
      case "projects.list":
      case "providers.list":
        void dispatchQuery(env, command);
        return;
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

/** Create production command dependencies backed by shared read and action helpers. */
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
    readStatus: () => buildStatusReport(
      { collectStatus, getVersions: getComponentVersions },
      getState(),
    ),
    readEnv: readEnvFile,
    readProjects: readProjectOverviews,
    readProviders: collectProvidersMeta,
    isKeyProviderSupported: realIsKeyProviderSupported,
    readProviderKeys: realReadProviderKeys,
    addProviderKey: realAddProviderKey,
    setActiveProviderKey: realSetActiveProviderKey,
    deleteProviderKey: realDeleteProviderKey,
    updateProviderKeyNote: realUpdateProviderKeyNote,
    applyActiveKey: realApplyActiveKey,
    removeAuthKey: realRemoveAuthKey,
    clearProviderCache: realClearProviderCache,
    readProviderAuthKey: realReadProviderAuthKey,
    waitForIdleSessions: () => waitForIdleSessions(probeIdleViaOpenCodeServer),
    gracefulRestartAiDev: async () => {
      try {
        const containerName = await getAiDevContainerRef();
        const project = await getComposeProject();
        const stop = await dockerCommand(`stop ${containerName}`, 60_000);
        if (stop.exitCode !== 0) {
          return { success: false, message: stop.stderr || stop.stdout || "Failed to stop ai-dev" };
        }

        const recreate = await dockerCommand(
          `compose -p ${project} up -d --force-recreate --no-deps ai-engkit`,
          180_000,
        );
        return recreate.exitCode === 0
          ? { success: true }
          : { success: false, message: recreate.stderr || recreate.stdout || "Compose recreate failed" };
      } catch (error: unknown) {
        return { success: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
