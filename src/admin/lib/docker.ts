/**
 * Docker compose exec orchestration helper.
 * Runs commands inside the ai-dev container via the Docker socket.
 */

const DOCKER_SOCKET = "/var/run/docker.sock";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function getAiDevContainerRef(): Promise<string> {
  for (const name of ["ai-engkit-dev", "ai-engkit"]) {
    const result = await runCommand(
      ["docker", "ps", "--filter", `name=${name}`, "--format", "{{.ID}}"],
      10_000,
    );
    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim().split("\n")[0];
    }
  }
  return "ai-engkit";
}

export async function execInAiDev(
  command: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExecResult> {
  const ref = await getAiDevContainerRef();
  const args = ["docker", "exec", ref, "sh", "-c", command];
  return runCommand(args, timeoutMs);
}

/**
 * Run a raw docker compose command against the compose file.
 */
export async function composeCommand(
  subcommand: string,
  timeoutMs: number = 120_000,
): Promise<ExecResult> {
  const args = ["docker", "compose", ...subcommand.split(/\s+/)];
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
  for (const name of ["ai-engkit-dev", "ai-engkit"]) {
    const result = await runCommand(
      ["docker", "ps", "--filter", "status=running", "--filter", `name=${name}`, "--format", "{{.Names}}"],
      10_000,
    );
    if (result.exitCode === 0 && result.stdout.trim().length > 0) return true;
  }
  return false;
}

/**
 * Get container uptime in seconds.
 */
export async function getAiDevUptime(): Promise<number | null> {
  const ref = await getAiDevContainerRef();
  const result = await runCommand(
    ["docker", "inspect", "--format={{.State.StartedAt}}", ref],
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
