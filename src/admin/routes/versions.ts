import { readFileSync } from "fs";
import { Hono } from "hono";
import { execInAiDev, dockerCommand, getAiDevContainerRef } from "../lib/docker";
import { VersionsPage } from "../views/versions";

async function getAiEngkitVersion(): Promise<string> {
  try {
    return readFileSync("/opt/ai-engkit/VERSION", "utf-8").trim();
  } catch {
    return "dev";
  }
}

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
  const ref = await getAiDevContainerRef();

  try {
    const result = await dockerCommand(
      `inspect --format='{{.Config.Image}}' ${ref} 2>/dev/null || echo "unknown"`,
      10_000,
    );
    meta["image"] = result.stdout.trim();
  } catch {
    meta["image"] = "unknown";
  }

  try {
    const digest = await dockerCommand(
      `inspect --format='{{.Image}}' ${ref} 2>/dev/null | cut -d: -f2 | cut -c1-12`,
      10_000,
    );
    meta["digest"] = digest.stdout.trim() || "unknown";
  } catch {
    meta["digest"] = "unknown";
  }

  try {
    const created = await dockerCommand(
      `inspect --format='{{.Created}}' ${ref} 2>/dev/null | cut -d. -f1`,
      10_000,
    );
    meta["created"] = created.stdout.trim() || "unknown";
  } catch {
    meta["created"] = "unknown";
  }

  meta["version"] = await getAiEngkitVersion();

  return c.json(meta);
});

versions.get("/api/versions", async (c) => {
  const categoryCommands: Record<string, Record<string, string>> = {
    core: {
      "OpenCode": "opencode --version 2>/dev/null || echo 'unavailable'",
      "OpenChamber": "/home/devuser/.bun/bin/openchamber --version 2>/dev/null || echo 'unavailable'",
      "lean-ctx": "lean-ctx --version 2>/dev/null || echo 'unavailable'",
      "Bun": "bun --version 2>/dev/null || echo 'unavailable'",
      "Docker": "docker --version 2>/dev/null | cut -d' ' -f3 | tr -d ',' || echo 'unavailable'",
      "Docker Compose": "docker compose version --short 2>/dev/null || echo 'unavailable'",
      "Docker Buildx": "docker buildx version 2>/dev/null | sed 's/.*v//' || echo 'unavailable'",
    },
    cli: {
      "gh": "gh --version 2>/dev/null | head -1 | cut -d' ' -f3 || echo 'unavailable'",
      "glab": "glab --version 2>/dev/null | cut -d' ' -f2 || echo 'unavailable'",
      "Git": "git --version 2>/dev/null | cut -d' ' -f3 || echo 'unavailable'",
      "Playwright": "bunx playwright --version 2>/dev/null | sed 's/^Version //' || echo 'unavailable'",
      "marksman": "marksman --version 2>/dev/null || echo 'unavailable'",
      "codegraph": "codegraph --version 2>/dev/null || echo 'unavailable'",
      "openspec": "openspec --version 2>/dev/null || echo 'unavailable'",
    },
    mcp: {
      "Playwright MCP": "pw-mcp --version 2>/dev/null | sed 's/^Version //' || echo 'unavailable'",
    },
    plugin: {
      "superpowers": "jq -r .version /opt/opencode/baked-plugins/superpowers/package.json 2>/dev/null || echo 'unavailable'",
      "oh-my-openagent": "bunx oh-my-openagent --version 2>/dev/null || echo 'unavailable'",
    },
  };

  const result: Record<string, Record<string, string>> = {};
  for (const [category, commands] of Object.entries(categoryCommands)) {
    const entries = Object.entries(commands);
    const settled = await Promise.allSettled(
      entries.map(([name, cmd]) => getVersion(name, cmd).then((v) => ({ name, version: v }))),
    );
    const categoryResult: Record<string, string> = {};
    for (const r of settled) {
      if (r.status === "fulfilled") {
        categoryResult[r.value.name] = r.value.version;
      }
    }
    result[category] = categoryResult;
  }
  return c.json(result);
});

versions.get("/versions", async (c) => {
  const baseUrl = c.req.url.replace("/versions", "");
  const cookie = c.req.header("cookie") || "";
  const headers = cookie ? { cookie } : {};
  const [versionsData, imageMeta] = await Promise.all([
    (await (await fetch(`${baseUrl}/api/versions`, { headers })).json()) as Record<string, Record<string, string>>,
    (await (await fetch(`${baseUrl}/api/versions/image`, { headers })).json()) as Record<string, string>,
  ]);
  return c.html(VersionsPage(versionsData, imageMeta));
});

export default versions;
