/**
 * Docker compose exec orchestration helper.
 * Runs commands inside the ai-dev container via the Docker socket.
 */

const DOCKER_SOCKET = "/var/run/docker.sock";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Get the current container's ID from /etc/hostname (set by Docker).
 * Used to inspect the admin container's own image metadata.
 */
export async function getSelfContainerRef(): Promise<string> {
  try {
    const id = await Bun.file("/etc/hostname").text();
    const trimmed = id.trim();
    if (trimmed) return trimmed;
  } catch {}
  return "ai-engkit-admin";
}

/**
 * Get the host-side source for one of this container's bind mounts.
 * Docker daemon paths must be used when a helper container controls DooD.
 */
export async function getSelfBindSource(destination: string): Promise<string | null> {
  const ref = await getSelfContainerRef();
  const result = await dockerCommand(
    `inspect --format='{{json .Mounts}}' ${ref}`,
    5_000,
  );
  if (result.exitCode !== 0 || !result.stdout) return null;

  try {
    const mounts = JSON.parse(result.stdout) as Array<{ Type?: string; Source?: string; Destination?: string }>;
    const mount = mounts.find((item) => item.Type === "bind" && item.Destination === destination);
    return mount?.Source || null;
  } catch {
    return null;
  }
}

/**
 * Get this container's own name (e.g. "ai-engkit-admin" or "ai-engkit-admin-dev").
 * Used to derive the sibling dev container name.
 */
async function getOwnContainerName(): Promise<string> {
  const ref = await getSelfContainerRef();
  const result = await runCommand(
    ["docker", "inspect", "--format={{.Name}}", ref],
    5_000,
  );
  if (result.exitCode === 0 && result.stdout.trim()) {
    // Docker name starts with "/"
    return result.stdout.trim().replace(/^\//, "");
  }
  return "ai-engkit-admin";
}

/**
 * Derive the dev container name from this admin container's name.
 * Convention: ai-engkit-admin → ai-engkit, ai-engkit-admin-dev → ai-engkit-dev
 */
async function getSiblingDevContainerName(): Promise<string> {
  const self = await getOwnContainerName();
  // Strip "-admin-dev" or "-admin" suffix to get the dev container name
  // ai-engkit-admin-dev → ai-engkit-dev,  ai-engkit-admin → ai-engkit
  if (self.endsWith("-admin-dev")) return self.slice(0, -"-admin-dev".length) + "-dev";
  if (self.endsWith("-admin")) return self.slice(0, -"-admin".length);
  return self;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Find the ai-dev container via its compose service label, scoped to the
 * same compose project as this admin container. Labels survive container_name
 * overrides (CI renames ai-dev to "ci-test"); the derived name does not.
 */
async function getAiDevContainerByService(): Promise<string> {
  const selfRef = await getSelfContainerRef();
  const projectResult = await dockerCommand(
    `inspect --format='{{index .Config.Labels "com.docker.compose.project"}}' ${selfRef}`,
    5_000,
  );
  const project = projectResult.exitCode === 0 ? projectResult.stdout.trim() : "";
  const filters = ["status=running", "label=com.docker.compose.service=ai-dev"];
  if (project) filters.push(`label=com.docker.compose.project=${project}`);
  const args = ["docker", "ps", "--format", "{{.ID}}"];
  for (const filter of filters) args.push("--filter", filter);
  const result = await runCommand(args, 10_000);
  if (result.exitCode === 0 && result.stdout.trim()) {
    return result.stdout.trim().split("\n")[0];
  }
  return "";
}

export async function getAiDevContainerRef(): Promise<string> {
  const byService = await getAiDevContainerByService();
  if (byService) return byService;

  const devName = await getSiblingDevContainerName();
  const result = await runCommand(
    ["docker", "ps", "--filter", "status=running", "--filter", `name=^/${devName}$`, "--format", "{{.ID}}"],
    10_000,
  );
  if (result.exitCode === 0 && result.stdout.trim()) {
    return result.stdout.trim().split("\n")[0];
  }
  return devName;
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
 * Detect the docker compose project name from this admin container's own
 * label. Falls back to "ai-engkit" if detection fails.
 */
export async function getComposeProject(): Promise<string> {
  const selfRef = await getSelfContainerRef();
  const result = await runCommand(
    ["docker", "inspect", "--format={{index .Config.Labels \"com.docker.compose.project\"}}", selfRef],
    5_000,
  );
  if (result.exitCode === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return "ai-engkit";
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
  const args = ["sh", "-c", `docker ${subcommand}`];
  return runCommand(args, timeoutMs);
}

/**
 * Check if the ai-dev container is running.
 */
export async function isAiDevRunning(): Promise<boolean> {
  const devName = await getSiblingDevContainerName();
  const result = await runCommand(
    ["docker", "ps", "--filter", "status=running", "--filter", `name=^/${devName}$`, "--format", "{{.Names}}"],
    10_000,
  );
  return result.exitCode === 0 && result.stdout.trim().length > 0;
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
