import { existsSync } from "node:fs";
import {
  dockerCommand,
  getAiDevContainerRef,
  getComposeProject,
  type ExecResult,
} from "./docker";

const COMPOSE_FILE = "/opt/ai-engkit/compose.yml";
const ENV_FILE = "/opt/ai-engkit/.env";

export interface AiDevRestartDeps {
  readonly composeFileExists: (path: string) => boolean;
  readonly getAiDevContainerRef: () => Promise<string>;
  readonly getComposeProject: () => Promise<string>;
  readonly dockerCommand: (command: string, timeoutMs: number) => Promise<ExecResult>;
}

const REAL_DEPS: AiDevRestartDeps = {
  composeFileExists: existsSync,
  getAiDevContainerRef,
  getComposeProject,
  dockerCommand,
};

export async function restartAiDev(
  deps: AiDevRestartDeps = REAL_DEPS,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    if (deps.composeFileExists(COMPOSE_FILE)) {
      const project = await deps.getComposeProject();
      const result = await deps.dockerCommand(
        `compose -p ${project} --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d --force-recreate ai-dev 2>&1`,
        120_000,
      );
      if (result.exitCode === 0) return { ok: true };
      return { ok: false, error: result.stderr || result.stdout || "Compose recreate failed" };
    }

    const ref = await deps.getAiDevContainerRef();
    const result = await deps.dockerCommand(`restart ${ref}`, 30_000);
    if (result.exitCode === 0) return { ok: true };
    return { ok: false, error: result.stderr || result.stdout || "Failed to restart ai-dev container" };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
