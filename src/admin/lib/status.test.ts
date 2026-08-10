import { describe, expect, test } from "bun:test";
import { collectStatus, type StatusDeps } from "./status";
import type { ExecResult } from "./docker";

const ok = (stdout: string): ExecResult => ({ stdout, stderr: "", exitCode: 0 });

interface DepOverrides {
  adminDigest?: string;
  aiDevDigest?: string;
  running?: boolean;
  uptime?: number | null;
}

/** Full fake dep set: gh/glab authenticated, git user "u", 3 projects. */
function makeDeps(overrides: DepOverrides = {}): StatusDeps {
  const adminDigest = overrides.adminDigest ?? "sha256:aaa";
  const aiDevDigest = overrides.aiDevDigest ?? "sha256:aaa";
  return {
    isAiDevRunning: async () => overrides.running ?? true,
    getAiDevUptime: async () => (overrides.uptime === undefined ? 3600 : overrides.uptime),
    getSelfContainerRef: async () => "self-ref",
    dockerCommand: async (subcommand: string) =>
      ok(subcommand.includes("self-ref") ? adminDigest : aiDevDigest),
    execInAiDev: async (command: string) => {
      if (command.startsWith("gh auth")) return ok("Logged in to github.com");
      if (command.startsWith("glab auth")) return ok("Logged in to gitlab.com");
      if (command.startsWith("git config")) return ok("u");
      if (command.startsWith("ls ~/workspace/")) return ok("3");
      return ok("");
    },
  };
}

describe("collectStatus", () => {
  test("assembles the pinned status shape from injected deps", async () => {
    const status = await collectStatus(makeDeps());
    expect(Object.keys(status).sort()).toEqual([
      "admin_version",
      "admin_version_mismatch",
      "container_status",
      "gh_auth",
      "git_user",
      "glab_auth",
      "project_count",
      "restart_count",
      "uptime_seconds",
    ]);
    expect(status).toMatchObject({
      container_status: "running",
      uptime_seconds: 3600,
      restart_count: 0,
      gh_auth: "authenticated",
      glab_auth: "authenticated",
      git_user: "u",
      project_count: 3,
      admin_version_mismatch: false,
    });
    expect(typeof status.admin_version).toBe("string");
  });

  test("flags admin_version_mismatch when the image digests differ", async () => {
    const status = await collectStatus(makeDeps({ adminDigest: "sha256:aaa", aiDevDigest: "sha256:bbb" }));
    expect(status.admin_version_mismatch).toBe(true);
  });

  test("reports a stopped container and unauthenticated CLIs", async () => {
    const deps = makeDeps({ running: false, uptime: null });
    deps.execInAiDev = async (command: string) => {
      if (command.startsWith("gh auth") || command.startsWith("glab auth")) {
        return { stdout: "", stderr: "not logged in", exitCode: 1 };
      }
      if (command.startsWith("git config")) return ok("");
      if (command.startsWith("ls ~/workspace/")) return ok("0");
      return ok("");
    };
    const status = await collectStatus(deps);
    expect(status.container_status).toBe("stopped");
    expect(status.uptime_seconds).toBeNull();
    expect(status.gh_auth).toBe("not authenticated");
    expect(status.glab_auth).toBe("not authenticated");
    expect(status.project_count).toBe(0);
  });
});
