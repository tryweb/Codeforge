import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { GitLabAuthPage } from "../views/glab-auth";

const glabAuth = new Hono();

interface GlabInstance {
  hostname: string;
  username: string;
  authenticated: boolean;
}

/**
 * Reduce a GitLab host input to its bare hostname.
 * Strips scheme and path so "https://gitlab.example.com/" → "gitlab.example.com".
 * A scheme-prefixed value here would create a malformed
 * `credential.https://https://...` git config section that never matches
 * any real remote, leaving git with no credential source.
 */
function normalizeHostname(input: string): string {
  return input.trim().replace(/^https?:\/\//i, "").split("/")[0];
}

/**
 * Configure git to use the git-credential-glab helper for the given hostname.
 *
 * The helper script is baked into the image at build time
 * (~/.local/bin/git-credential-glab — see scripts/git-credential-glab and the
 * Dockerfile), so it survives container recreation. Only the git config
 * needs to be (re)applied after a successful glab auth login.
 *
 * This replaces the insecure ~/.git-credentials plaintext approach with
 * on-demand token reads from glab's own config.yml — the single source
 * of truth for authentication.
 */
async function setupGlabCredentialHelper(hostname: string): Promise<void> {
  // Remove the global store helper (older entrypoints re-added it on every
  // start) so git never caches the token back to plaintext on disk.
  await execInAiDev("git config --global --unset credential.helper 2>/dev/null || true", 5_000);

  // Defensive re-normalization: only a bare hostname may enter the git config key.
  const escHost = JSON.stringify(normalizeHostname(hostname));
  await execInAiDev(`git config --global credential.https://${escHost}.helper glab 2>/dev/null || true`, 5_000);
  await execInAiDev(`git config --global credential.http://${escHost}.helper glab 2>/dev/null || true`, 5_000);

  await execInAiDev(": > ~/.config/git/.git-credentials 2>/dev/null || true", 5_000);
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
  const hostname = normalizeHostname(body.hostname || "gitlab.com");
  const token = body.token || "";

  if (token) {
    const result = await execInAiDev(
      `glab auth login --hostname ${JSON.stringify(hostname)} --token ${JSON.stringify(token)} 2>&1 || true`,
      30_000,
    );
    if (result.exitCode !== 0) {
      return c.json({ error: result.stderr || "Authentication failed" }, 500);
    }
    // Configure git credential helper so git operations (fetch, clone)
    // authenticate via glab's token instead of insecure plaintext storage.
    await setupGlabCredentialHelper(hostname);
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
