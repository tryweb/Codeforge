import { Hono } from "hono";
import { dockerCommand, runCommand, getComposeProject, getSelfBindSource, getSelfContainerRef } from "../lib/docker";
import { readFileSync } from "node:fs";

const admin = new Hono();

async function getAdminVersion(): Promise<string> {
  try {
    return readFileSync("/opt/ai-engkit/VERSION", "utf-8").trim();
  } catch {
    return "unknown";
  }
}

async function getAdminImageDigest(): Promise<string | null> {
  const ref = await getSelfContainerRef();
  const result = await dockerCommand(
    `inspect --format='{{.Image}}' ${ref}`,
    10_000,
  );
  if (result.exitCode !== 0 || !result.stdout) return null;
  return result.stdout.trim();
}

async function getAdminUptime(): Promise<number | null> {
  const ref = await getSelfContainerRef();
  const result = await dockerCommand(
    `inspect --format='{{.State.StartedAt}}' ${ref}`,
    10_000,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  const startedAt = new Date(result.stdout.trim());
  return Math.floor((Date.now() - startedAt.getTime()) / 1000);
}

admin.get("/api/admin/status", async (c) => {
  const [version, imageDigest, uptime] = await Promise.all([
    getAdminVersion(),
    getAdminImageDigest(),
    getAdminUptime(),
  ]);

  return c.json({
    version,
    image_digest: imageDigest,
    uptime_seconds: uptime,
  });
});

/**
 * Response sent BEFORE restart to avoid connection drop.
 * Client polls /healthz after receiving response.
 * Uses compose recreate so admin picks up the latest ghcr.io image.
 */
admin.post("/api/admin/restart", async (c) => {
  const responsePromise = c.json({ ok: true, message: "Admin pulling latest image and recreating..." });
  
  setTimeout(async () => {
    const project = await getComposeProject().catch(() => "ai-engkit");
    const envSource = await getSelfBindSource("/opt/ai-engkit/.env");
    const composeSource = await getSelfBindSource("/opt/ai-engkit/compose.yml");
    if (!envSource || !composeSource) return;

    // Run compose in a separate container so it survives admin being killed.
    // Use --entrypoint /usr/local/bin/docker with direct args to avoid triple-nested
    // sh -c quoting issues (Bug 4). No shell quoting needed — runCommand passes argv directly.
    const dockerArgs = [
      "docker", "run", "--rm", "--user", "0",
      "--entrypoint", "/usr/local/bin/docker",
      "-v", `${envSource}:${envSource}:ro`,
      "-v", `${composeSource}:${composeSource}:ro`,
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "ghcr.io/tryweb/ai-engkit:latest",
      "compose", "-p", project,
      "--env-file", envSource,
      "-f", composeSource,
      "up", "-d", "--force-recreate", "ai-admin",
    ];
    runCommand(dockerArgs, 120_000);
  }, 2000);
  
  return responsePromise;
});

export default admin;
