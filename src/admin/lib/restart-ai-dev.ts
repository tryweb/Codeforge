import { existsSync } from "node:fs";
import {
  dockerCommand,
  execInAiDev,
  getAiDevContainerRef,
  getComposeProject,
  type ExecResult,
} from "./docker";
import { readEnvFile } from "./env";
import { MANAGED_OPENCODE_DIR } from "./agent-model-types";

const COMPOSE_FILE = "/opt/ai-engkit/compose.yml";
const ENV_FILE = "/opt/ai-engkit/.env";

export interface AiDevRestartDeps {
  readonly composeFileExists: (path: string) => boolean;
  readonly getAiDevContainerRef: () => Promise<string>;
  readonly getComposeProject: () => Promise<string>;
  readonly dockerCommand: (command: string, timeoutMs: number) => Promise<ExecResult>;
}

export interface ManagedRestartDeps {
  readonly exec: (command: string, timeoutMs: number) => Promise<ExecResult>;
  readonly readEnv: () => Record<string, string>;
}

const REAL_DEPS: AiDevRestartDeps = {
  composeFileExists: existsSync,
  getAiDevContainerRef,
  getComposeProject,
  dockerCommand,
};

const REAL_MANAGED_DEPS: ManagedRestartDeps = {
  exec: execInAiDev,
  readEnv: readEnvFile,
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

export async function restartManagedOpenCode(
  deps: ManagedRestartDeps = REAL_MANAGED_DEPS,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const password = deps.readEnv()["OPENCODE_SERVER_PASSWORD"] ?? "";
  const auth = Buffer.from(`opencode:${password}`).toString("base64");
  const managedDir = MANAGED_OPENCODE_DIR.replace(/^~/, "$HOME");
  const script = `set -u
MANAGED_DIR="${managedDir}"
pid_file="$(ls -t "$MANAGED_DIR"/*.json 2>/dev/null | head -n1)" || {
  printf '%s\n' 'managed-opencode pid file missing' >&2
  exit 10
}
[ -n "$pid_file" ] || {
  printf '%s\n' 'managed-opencode pid file missing' >&2
  exit 10
}
pid="$(jq -r '.pid // empty' "$pid_file" 2>/dev/null)"
port="$(jq -r '.port // empty' "$pid_file" 2>/dev/null)"
[ -n "$pid" ] || {
  printf '%s\n' 'managed-opencode pid file missing' >&2
  exit 10
}
[ -n "$port" ] || {
  printf '%s\n' 'managed-opencode pid file missing' >&2
  exit 10
}
kill "$pid" 2>/dev/null || {
  printf '%s\n' 'managed-opencode kill failed' >&2
  exit 11
}
for waited in 0 3 6 9 12 15 18 21 24 27 30 33 36 39 42 45 48 51 54 57 60; do
  sleep 3
  endpoint="http://127.0.0.1:$port"
  if curl -fsS -m 3 -H 'Authorization: Basic ${auth}' "$endpoint/global/health" >/dev/null 2>&1; then
    printf '%s\n' "$endpoint"
    exit 0
  fi
done
printf '%s\n' 'managed-opencode health timeout' >&2
exit 12`;

  try {
    const result = await deps.exec(script, 75_000);
    if (result.exitCode === 0) return { ok: true };
    if (result.exitCode === 10) return { ok: false, error: "managed OpenCode pid file missing" };
    if (result.exitCode === 11) return { ok: false, error: "managed OpenCode kill failed" };
    if (result.exitCode === 12) return { ok: false, error: "managed OpenCode health timeout" };
    return { ok: false, error: result.stderr || result.stdout || "managed OpenCode restart failed" };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
