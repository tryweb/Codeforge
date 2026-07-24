import { Hono } from "hono";
import { isAiDevRunning, getAiDevUptime } from "../lib/docker";
import { execInAiDev } from "../lib/docker";
import { readEnvFile } from "../lib/env";

const status_route = new Hono();

status_route.get("/api/status", async (c) => {
  const [containerRunning, uptime, ghResult, glabResult, gitResult, projectsResult] =
    await Promise.all([
      isAiDevRunning(),
      getAiDevUptime(),
      execInAiDev("gh auth status 2>&1 || true", 10_000),
      execInAiDev("glab auth status 2>&1 || true", 10_000),
      execInAiDev("git config --global user.name 2>/dev/null || echo ''", 10_000),
      execInAiDev("ls ~/workspace/ 2>/dev/null | wc -l || echo '0'", 10_000),
    ]);

  const ghAuth = ghResult.stdout.includes("Logged in") || ghResult.stderr.includes("Logged in")
    ? "authenticated"
    : "not authenticated";
  const glabAuth = glabResult.stdout.includes("Logged in") || glabResult.stderr.includes("Logged in")
    ? "authenticated"
    : "not authenticated";
  const gitUser = gitResult.stdout.trim();
  const projectCount = parseInt(projectsResult.stdout.trim() || "0", 10);

  return c.json({
    container_status: containerRunning ? "running" : "stopped",
    uptime_seconds: uptime,
    restart_count: 0,
    gh_auth: ghAuth,
    glab_auth: glabAuth,
    git_user: gitUser,
    project_count: projectCount,
  });
});

status_route.get("/healthz", (c) => {
  return c.json({ status: "ok" });
});

export default status_route;
