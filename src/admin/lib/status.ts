import {
  isAiDevRunning,
  getAiDevUptime,
  getSelfContainerRef,
  dockerCommand,
  execInAiDev,
  type ExecResult,
} from "./docker";
import { readFileSync } from "node:fs";

export type AuthStatus = "authenticated" | "not authenticated";

export interface StatusResponse {
  container_status: "running" | "stopped";
  uptime_seconds: number | null;
  restart_count: number;
  gh_auth: AuthStatus;
  glab_auth: AuthStatus;
  git_user: string;
  project_count: number;
  admin_version: string;
  admin_version_mismatch: boolean;
}

export interface StatusDeps {
  isAiDevRunning: () => Promise<boolean>;
  getAiDevUptime: () => Promise<number | null>;
  getSelfContainerRef: () => Promise<string>;
  dockerCommand: (subcommand: string, timeoutMs: number) => Promise<ExecResult>;
  execInAiDev: (command: string, timeoutMs: number) => Promise<ExecResult>;
}

const DEFAULT_DEPS: StatusDeps = {
  isAiDevRunning,
  getAiDevUptime,
  getSelfContainerRef,
  dockerCommand,
  execInAiDev,
};

async function getAdminVersion(): Promise<string> {
  try {
    return readFileSync("/opt/ai-engkit/VERSION", "utf-8").trim();
  } catch {
    return "unknown";
  }
}

async function getAdminImageDigest(deps: StatusDeps): Promise<string | null> {
  const ref = await deps.getSelfContainerRef();
  const result = await deps.dockerCommand(
    `inspect --format='{{.Image}}' ${ref}`,
    10_000,
  );
  if (result.exitCode !== 0 || !result.stdout) return null;
  return result.stdout.trim();
}

async function getAiDevImageDigest(deps: StatusDeps): Promise<string | null> {
  const result = await deps.dockerCommand(
    `inspect --format='{{.Image}}' ai-engkit`,
    10_000,
  );
  if (result.exitCode !== 0 || !result.stdout) return null;
  return result.stdout.trim();
}

export async function collectStatus(overrides: Partial<StatusDeps> = {}): Promise<StatusResponse> {
  const deps: StatusDeps = { ...DEFAULT_DEPS, ...overrides };
  const [containerRunning, uptime, ghResult, glabResult, gitResult, projectsResult, adminVersion, adminDigest, aiDevDigest] =
    await Promise.all([
      deps.isAiDevRunning(),
      deps.getAiDevUptime(),
      deps.execInAiDev("gh auth status 2>&1 || true", 10_000),
      deps.execInAiDev("glab auth status 2>&1 || true", 10_000),
      deps.execInAiDev("git config --global user.name 2>/dev/null || echo ''", 10_000),
      deps.execInAiDev("ls ~/workspace/ 2>/dev/null | wc -l || echo '0'", 10_000),
      getAdminVersion(),
      getAdminImageDigest(deps),
      getAiDevImageDigest(deps),
    ]);

  const ghAuth: AuthStatus = ghResult.stdout.includes("Logged in") || ghResult.stderr.includes("Logged in")
    ? "authenticated"
    : "not authenticated";
  const glabAuth: AuthStatus = glabResult.stdout.includes("Logged in") || glabResult.stderr.includes("Logged in")
    ? "authenticated"
    : "not authenticated";
  const gitUser = gitResult.stdout.trim();
  const projectCount = parseInt(projectsResult.stdout.trim() || "0", 10);
  const adminVersionMismatch = adminDigest !== null && aiDevDigest !== null && adminDigest !== aiDevDigest;

  return {
    container_status: containerRunning ? "running" : "stopped",
    uptime_seconds: uptime,
    restart_count: 0,
    gh_auth: ghAuth,
    glab_auth: glabAuth,
    git_user: gitUser,
    project_count: projectCount,
    admin_version: adminVersion,
    admin_version_mismatch: adminVersionMismatch,
  };
}
