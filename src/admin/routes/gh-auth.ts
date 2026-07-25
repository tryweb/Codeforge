import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { GitHubAuthPage } from "../views/gh-auth";

const ghAuth = new Hono();

async function getGhStatus(): Promise<string> {
  const result = await execInAiDev("gh auth status 2>&1 || true", 15_000);
  if (result.stdout.includes("Logged in") || result.stderr.includes("Logged in")) {
    return "authenticated";
  }
  return "not authenticated";
}

interface GhUserInfo {
  login: string;
  avatar_url: string;
  name: string;
  scopes: string[];
}

async function getGhUserInfo(): Promise<GhUserInfo | null> {
  const profileResult = await execInAiDev("gh api user 2>/dev/null || true", 10_000);
  const scopesResult = await execInAiDev(
    "gh auth status 2>&1 | grep -oP \"Token scopes: '\\K[^']+\" || true",
    10_000,
  );

  let login = "", avatar_url = "", name = "";
  try {
    const profile = JSON.parse(profileResult.stdout);
    login = profile.login || "";
    avatar_url = profile.avatar_url || "";
    name = profile.name || "";
  } catch {
    return null;
  }

  const scopes = scopesResult.stdout
    ? scopesResult.stdout.trim().split(",").map((s: string) => s.trim())
    : [];

  return { login, avatar_url, name, scopes };
}

ghAuth.get("/api/auth/gh/status", async (c) => {
  const status = await getGhStatus();
  return c.json({ status });
});

ghAuth.get("/api/auth/gh/user", async (c) => {
  const user = await getGhUserInfo();
  return c.json(user || {});
});

ghAuth.post("/api/auth/gh/start", async (c) => {
  // Start the device code flow in background, capture initial output
  const result = await execInAiDev(
    "nohup sh -c 'gh auth login --web --hostname github.com >/tmp/gh-device.log 2>&1 &' && sleep 1 && cat /tmp/gh-device.log 2>/dev/null || true",
    10_000,
  );
  const output = result.stdout || result.stderr;

  // Parse device code from output
  let deviceCode = "";
  let verificationUri = "https://github.com/login/device";

  const codeMatch = output.match(/(?:code|Code):\s*([A-Z0-9-]+)/);
  if (codeMatch) deviceCode = codeMatch[1];

  const uriMatch = output.match(/https?:\/\/[^\s]+/);
  if (uriMatch) verificationUri = uriMatch[0];

  return c.json({ device_code: deviceCode, verification_uri: verificationUri });
});

ghAuth.post("/api/auth/gh/logout", async (c) => {
  await execInAiDev("gh auth logout 2>/dev/null || true", 15_000);
  return c.json({ ok: true });
});

ghAuth.get("/auth/github", async (c) => {
  const status = await getGhStatus();
  return c.html(GitHubAuthPage(status));
});

export default ghAuth;
