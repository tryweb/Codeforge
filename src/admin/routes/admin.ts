import { Hono } from "hono";
import { dockerCommand, getComposeProject, getSelfContainerRef } from "../lib/docker";
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
    await dockerCommand(
      `compose -p ${project} --env-file /opt/ai-engkit/.env -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-engkit-admin`,
      120_000,
    ).catch(() => {});
  }, 2000);
  
  return responsePromise;
});

export default admin;
