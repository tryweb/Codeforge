/**
 * Docker compose exec orchestration helper.
 * Runs commands inside the ai-dev container via the Docker socket.
 * All exec calls use `-T` (no TTY) for machine-parseable stdout.
 */

const DOCKER_SOCKET = "/var/run/docker.sock";
const COMPOSE_FILE = "/opt/ai-engkit/compose.yml";
const SERVICE = "ai-dev";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command inside the ai-dev container via `docker compose exec`.
 */
export async function execInAiDev(
  command: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExecResult> {
  const args = ["docker", "compose", "-f", COMPOSE_FILE, "exec", "-T", SERVICE, "sh", "-c", command];
  return runCommand(args, timeoutMs);
}

/**
 * Run a raw docker compose command against the compose file.
 */
export async function composeCommand(
  subcommand: string,
  timeoutMs: number = 120_000,
): Promise<ExecResult> {
  const args = ["docker", "compose", "-f", COMPOSE_FILE, ...subcommand.split(/\s+/)];
  return runCommand(args, timeoutMs);
}

/**
 * Run a raw docker command.
 */
export async function dockerCommand(
  subcommand: string,
  timeoutMs: number = 120_000,
): Promise<ExecResult> {
  const args = ["docker", ...subcommand.split(/\s+/)];
  return runCommand(args, timeoutMs);
}

/**
 * Check if the ai-dev container is running.
 */
export async function isAiDevRunning(): Promise<boolean> {
  const result = await runCommand(
    ["docker", "compose", "-f", COMPOSE_FILE, "ps", "--filter", "status=running", "--format", "json"],
    10_000,
  );
  if (result.exitCode !== 0) return false;
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return lines.some((line) => line.includes("ai-dev") || line.includes("ai-engkit"));
}

/**
 * Get container uptime in seconds.
 */
export async function getAiDevUptime(): Promise<number | null> {
  const result = await runCommand(
    ["docker", "inspect", "--format={{.State.StartedAt}}", "ai-engkit"],
    10_000,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  const startedAt = new Date(result.stdout.trim());
  return Math.floor((Date.now() - startedAt.getTime()) / 1000);
}

/**
 * Low-level command runner with timeout enforcement.
 * Uses explicit args array to avoid shell quoting issues.
 */
async function runCommand(
  args: string[],
  timeoutMs: number,
): Promise<ExecResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const process = Bun.spawn(args, {
      signal: controller.signal,
      env: { ...Bun.env, DOCKER_HOST: "unix://" + DOCKER_SOCKET },
    });

    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();
    const exitCode = await process.exited;

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { stdout: "", stderr: `Command timed out after ${timeoutMs}ms`, exitCode: -1 };
    }
    return { stdout: "", stderr: String(err), exitCode: -1 };
  } finally {
    clearTimeout(timer);
  }
}

export { runCommand };
