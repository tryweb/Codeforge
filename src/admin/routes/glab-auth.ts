import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import {
  listGlabInstances,
  loginGlabWithToken,
  logoutGlab,
  normalizeHostname,
} from "../lib/glab-auth";

const glabAuth = new Hono();

glabAuth.get("/api/auth/glab/status", async (c) => {
  const instances = await listGlabInstances();
  const anyAuth = instances.some((i) => i.authenticated);
  const hostname = c.req.query("hostname");
  if (hostname) {
    const inst = instances.find((i) => i.hostname === hostname);
    return c.json({ status: inst ? (inst.authenticated ? "authenticated" : "not authenticated") : "not authenticated", instances });
  }
  return c.json({ status: anyAuth ? "authenticated" : "not authenticated", instances });
});

glabAuth.post("/api/auth/glab/start", async (c) => {
  const body = await c.req.json().catch(() => ({ hostname: "gitlab.com" }));
  const hostname = normalizeHostname(body.hostname || "gitlab.com");
  const token = body.token || "";

  if (token) {
    const result = await loginGlabWithToken(hostname, token);
    if ("error" in result) {
      return c.json({ error: result.error }, 500);
    }
    return c.json({ ok: true });
  }

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
  const body = await c.req.json().catch(() => ({}));
  const hostname = body.hostname || "";
  await logoutGlab(hostname);
  return c.json({ ok: true });
});

export default glabAuth;
