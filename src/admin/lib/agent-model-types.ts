import type { ExecResult } from "./docker";

export interface FallbackModelEntry {
  readonly model: string;
  readonly variant?: string;
}

export interface ResolvedModel {
  readonly modelID: string;
  readonly providerID: string;
}

export interface AgentModelEntry {
  readonly name: string;
  readonly configured: readonly FallbackModelEntry[];
  readonly resolved: ResolvedModel | null;
  readonly source: "configured" | "inherited" | "plugin";
  readonly invalid: boolean;
  readonly effectiveness: "effective" | "runtime_mismatch" | "invalid" | "plugin" | "unverified";
}

export interface AgentModelConfig {
  readonly model?: string;
  readonly variant?: string;
  readonly models?: readonly FallbackModelEntry[];
  readonly invalid: boolean;
}

export type ApplyResult =
  | { readonly ok: true; readonly status: "verified"; readonly resolved: ResolvedModel | null }
  | {
      readonly ok: false;
      readonly status: "runtime_mismatch";
      readonly configured: string;
      readonly resolved: ResolvedModel | null;
      readonly error: string;
    }
  | { readonly ok: false; readonly status: "write_failed"; readonly error: string }
  | { readonly ok: false; readonly status: "restart_failed"; readonly error: string }
  | { readonly ok: false; readonly status: "unverified"; readonly error: string };

export interface AgentModelsDeps {
  readonly exec: (command: string, timeoutMs?: number) => Promise<ExecResult>;
  readonly restart: () => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly readEnv: () => Record<string, string>;
  readonly snapshotDir: string;
}

export const OMO_CONFIG = "~/.omo/omo.jsonc";
export const MANAGED_OPENCODE_DIR = "~/.config/openchamber/managed-opencode";
export const CONFIGURABLE_NATIVE_AGENTS = ["general"] as const;
export const VARIANTS = ["low", "medium", "high", "xhigh", "max"] as const;
