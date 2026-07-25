import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { GitLabAuthPage } from "../views/glab-auth";

const glabAuth = new Hono();

interface GlabInstance {
  hostname: string;
  username: string;
  authenticated: boolean;
}

async function parseGlabInstances(): Promise<GlabInstance[]> {
  // Read token-bearing hosts from config.yml
  const configResult = await execInAiDev(
    `python3 -c '
import yaml
with open("/home/devuser/.config/glab-cli/config.yml") as f:
    data = yaml.safe_load(f)
hosts = data.get("hosts", {})
for h, cfg in hosts.items():
    token = cfg.get("token", "") or ""
    if token:
        print(h)
' 2>/dev/null || true`,
    15_000,
  );

  const instances: GlabInstance[] = [];
  const tokenHosts = new Set(configResult.stdout.trim().split("\n").filter(Boolean));

  if (tokenHosts.size === 0) return instances;

  // Fetch usernames from glab auth status for each host
  const statusResult = await execInAiDev("glab auth status 2>&1 || true", 15_000);
  const output = statusResult.stdout || statusResult.stderr;
  const usernameMap = new Map<string, string>();

  for (const line of output.split("\n")) {
    const m = line.match(/Logged in to (\S+) as (\S+)/);
    if (m) usernameMap.set(m[1], m[2]);
  }

  for (const hostname of tokenHosts) {
    instances.push({
      hostname,
      username: usernameMap.get(hostname) || "",
      authenticated: true,
    });
  }

  return instances;
}

glabAuth.get("/api/auth/glab/status", async (c) => {
  const instances = await parseGlabInstances();
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
  const hostname = body.hostname || "gitlab.com";
  const token = body.token || "";

  if (token) {
    const result = await execInAiDev(
      `glab auth login --hostname ${JSON.stringify(hostname)} --token ${JSON.stringify(token)} 2>&1 || true`,
      30_000,
    );
    if (result.exitCode !== 0) {
      return c.json({ error: result.stderr || "Authentication failed" }, 500);
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
  if (hostname) {
    await execInAiDev(`glab auth logout --hostname ${JSON.stringify(hostname)} 2>/dev/null || true`, 15_000);
    await execInAiDev(
      `python3 -c '
import yaml
with open("/home/devuser/.config/glab-cli/config.yml") as f:
    data = yaml.safe_load(f)
hosts = data.get("hosts", {})
h = "${hostname}"
if h in hosts:
    del hosts[h]
    data["hosts"] = hosts
    with open("/home/devuser/.config/glab-cli/config.yml", "w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
' 2>/dev/null || true`,
      15_000,
    );
  } else {
    await execInAiDev("glab auth logout 2>/dev/null || true", 15_000);
  }
  return c.json({ ok: true });
});

glabAuth.get("/auth/gitlab", async (c) => {
  const instances = await parseGlabInstances();
  const anyAuth = instances.some((i) => i.authenticated);
  return c.html(GitLabAuthPage(instances, anyAuth ? "authenticated" : "not authenticated"));
});

export default glabAuth;
