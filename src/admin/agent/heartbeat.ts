import { execInAiDev } from "../lib/docker";
import type { StatusResponse } from "../lib/status";

export interface StatusReport {
  container_status: "running" | "stopped";
  uptime_seconds: number | null;
  versions: Record<string, string>;
  gh_auth: "authenticated" | "not authenticated";
  glab_auth: "authenticated" | "not authenticated";
  admin_version: string;
  admin_version_mismatch: boolean;
  upgrade_state: string;
}

export interface HeartbeatDeps {
  collectStatus: () => Promise<StatusResponse>;
  getVersions: () => Promise<Record<string, string>>;
}

function getVersion(command: string): Promise<string> {
  return execInAiDev(command, 15_000).then(
    (result) => {
      if (result.exitCode !== 0 || !result.stdout) return "";
      return result.stdout.split("\n")[0]?.trim() ?? "";
    },
    () => "",
  );
}

/** Collect component versions from the shared ai-dev command adapter. */
export async function getComponentVersions(): Promise<Record<string, string>> {
  const [aiEngkit, openCode, openChamber, docker] = await Promise.all([
    getVersion("cat /opt/ai-engkit/VERSION"),
    getVersion("opencode --version 2>/dev/null || echo ''"),
    getVersion("/home/devuser/.bun/bin/openchamber --version 2>/dev/null || echo ''"),
    getVersion("docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',' || echo ''"),
  ]);

  return {
    "AI-EngKit": aiEngkit,
    OpenCode: openCode,
    OpenChamber: openChamber,
    Docker: docker,
  };
}

/** Build the heartbeat payload from the shared local status collector. */
export async function buildStatusReport(
  deps: HeartbeatDeps,
  upgradeState: string,
): Promise<StatusReport> {
  const [status, versions] = await Promise.all([
    deps.collectStatus(),
    deps.getVersions(),
  ]);

  return {
    container_status: status.container_status,
    uptime_seconds: status.uptime_seconds,
    versions,
    gh_auth: status.gh_auth,
    glab_auth: status.glab_auth,
    admin_version: status.admin_version,
    admin_version_mismatch: status.admin_version_mismatch,
    upgrade_state: upgradeState,
  };
}

/** Return the fixed delay between heartbeat reports. */
export function heartbeatIntervalMs(): number {
  return 60_000;
}
