import { createAgentRuntime } from "./client";
import type { AgentConnectionState, AgentRuntime } from "./client";

type AgentStartOptions = {
  centerUrl?: string;
  env?: Record<string, string | undefined>;
};

/** Current connection state and the most recent agent error. */
export interface AgentStatus {
  readonly state: AgentConnectionState;
  readonly last_error: string | null;
}

let runtime: AgentRuntime | null = null;
let started = false;
let stopped = false;

function hasCenterUrl(opts: AgentStartOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const centerUrl = opts.centerUrl ?? env["CENTER_URL"] ?? process.env["CENTER_URL"];
  return centerUrl !== undefined && centerUrl.trim() !== "";
}

/** Start the singleton agent runtime when it is not already active. */
export function startAgent(opts?: AgentStartOptions): void {
  if (started) return;

  runtime ??= createAgentRuntime({});
  runtime.start(opts);
  started = hasCenterUrl(opts);
  stopped = false;
}

/** Stop the singleton agent runtime while retaining its status history. */
export function stopAgent(): void {
  if (runtime === null) return;

  runtime.stop();
  started = false;
  stopped = true;
}

/** Return the current singleton agent status. */
export function getAgentStatus(): AgentStatus {
  if (runtime === null) return { state: "disabled", last_error: null };

  return {
    state: stopped ? "disconnected" : runtime.getState(),
    last_error: runtime.getLastError(),
  };
}

/** Return whether CENTER_URL enables agent mode in the process environment. */
export function isAgentEnabled(): boolean {
  return hasCenterUrl();
}
