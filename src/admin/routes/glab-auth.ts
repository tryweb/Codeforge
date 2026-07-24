import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { GitLabAuthPage } from "../views/glab-auth";

const glabAuth = new Hono();

async function getGlabStatus(): Promise<string> {
  const result = await execInAiDev("glab auth status 2>&1 || true", 15_000);
  if (result.stdout.includes("Logged in") || result.stderr.includes("Logged in")) {
    return "authenticated";
  }
  return "not authenticated";
}

glabAuth.get("/api/auth/glab/status", async (c) => {
  const status = await getGlabStatus();
  return c.json({ status });
});

glabAuth.post("/api/auth/glab/start", async (c) => {
  const body = await c.req.json().catch(() => ({ hostname: "gitlab.com" }));
  const hostname = body.hostname || "gitlab.com";

  const result = await execInAiDev(
    `glab auth login --hostname ${JSON.stringify(hostname)} 2>&1 || true`,
    30_000,
  );
  const output = result.stdout || result.stderr;

  let deviceCode = "";
  let verificationUri = "https://gitlab.com/activate";

  const codeMatch = output.match(/(?:code|Code):\s*([A-Z0-9-]+)/);
  if (codeMatch) deviceCode = codeMatch[1];

  const uriMatch = output.match(/https?:\/\/[^\s]+/);
  if (uriMatch) verificationUri = uriMatch[0];

  return c.json({ device_code: deviceCode, verification_uri: verificationUri });
});

glabAuth.post("/api/auth/glab/logout", async (c) => {
  await execInAiDev("glab auth logout 2>/dev/null || true", 15_000);
  return c.json({ ok: true });
});

glabAuth.get("/auth/gitlab", async (c) => {
  const status = await getGlabStatus();
  return c.html(GitLabAuthPage(status));
});

export default glabAuth;
