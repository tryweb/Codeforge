import { Hono } from "hono";
import { execInAiDev, dockerCommand } from "../lib/docker";
import { VersionsPage } from "../views/versions";

const versions = new Hono();

async function getVersion(name: string, command: string): Promise<string> {
  try {
    const result = await execInAiDev(command, 15_000);
    if (result.exitCode === 0 && result.stdout) {
      // Take first line, trim
      return result.stdout.split("\n")[0].trim();
    }
    return "";
  } catch {
    return "";
  }
}

versions.get("/api/versions/image", async (c) => {
  const meta: Record<string, string> = {};
  try {
    const result = await dockerCommand(
      'inspect --format=\'{{.Config.Image}}\' ai-engkit 2>/dev/null || echo "unknown"',
      10_000,
    );
    meta["image"] = result.stdout.trim();

    const digest = await dockerCommand(
      'inspect --format=\'{{.Image}}\' ai-engkit 2>/dev/null | cut -d: -f2 | cut -c1-12',
      10_000,
    );
    meta["digest"] = digest.stdout.trim() || "unknown";

    const created = await dockerCommand(
      'inspect --format=\'{{.Created}}\' ai-engkit 2>/dev/null | cut -d. -f1',
      10_000,
    );
    meta["created"] = created.stdout.trim() || "unknown";
  } catch {
    meta["error"] = "Could not read image metadata";
  }
  return c.json(meta);
});

versions.get("/api/versions", async (c) => {
  const versionCommands: Record<string, string> = {
    "OpenCode": "opencode --version 2>/dev/null || echo 'unavailable'",
    "OpenChamber": "cat /opt/openchamber/version.txt 2>/dev/null || echo 'unavailable'",
    "Bun": "bun --version 2>/dev/null || echo 'unavailable'",
    "Docker": "docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',' || echo 'unavailable'",
    "Docker Compose": "docker compose version --short 2>/dev/null || echo 'unavailable'",
    "gh": "gh --version 2>/dev/null | head -1 | cut -d' ' -f3 || echo 'unavailable'",
    "glab": "glab --version 2>/dev/null | cut -d' ' -f3 || echo 'unavailable'",
    "Git": "git --version 2>/dev/null | cut -d' ' -f3 || echo 'unavailable'",
    "Node": "node --version 2>/dev/null || echo 'unavailable'",
    "lean-ctx": "lean-ctx --version 2>/dev/null || echo 'unavailable'",
    "Playwright": "npx playwright --version 2>/dev/null || echo 'unavailable'",
  };

  const versions: Record<string, string> = {};
  const entries = Object.entries(versionCommands);
  const results = await Promise.allSettled(
    entries.map(([name, cmd]) => getVersion(name, cmd).then((v) => ({ name, version: v }))),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      versions[result.value.name] = result.value.version;
    }
  }
  return c.json(versions);
});

versions.get("/versions", async (c) => {
  const [versionsData, imageMeta] = await Promise.all([
    (await (await fetch(`${c.req.url.replace("/versions", "")}/api/versions`)).json()) as Record<string, string>,
    (await (await fetch(`${c.req.url.replace("/versions", "")}/api/versions/image`)).json()) as Record<string, string>,
  ]);
  return c.html(VersionsPage(versionsData, imageMeta));
});

export default versions;
