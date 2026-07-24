import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { ProjectsPage } from "../views/projects";

const projects = new Hono();

const FEATURES = ["knowledge", "maintenance", "openspec"] as const;
type Feature = (typeof FEATURES)[number];

async function listProjects(): Promise<string[]> {
  const result = await execInAiDev("ls ~/workspace/ 2>/dev/null || echo ''", 10_000);
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean);
}

async function checkFeature(name: string, markerCmd: string): Promise<boolean> {
  const r = await execInAiDev(
    `test -e /home/devuser/workspace/${JSON.stringify(name)}/${markerCmd} && echo yes`,
    5_000,
  );
  return r.stdout.trim() === "yes";
}

projects.get("/api/projects", async (c) => {
  const list = await listProjects();
  return c.json(list);
});

projects.get("/api/projects/:name/features", async (c) => {
  const name = c.req.param("name");
  if (!name || name.includes("..")) return c.json({ error: "Invalid project name" }, 400);

  // Verify project exists
  const exists = await execInAiDev(`test -d ~/workspace/${JSON.stringify(name)} && echo yes`, 5_000);
  if (exists.stdout.trim() !== "yes") return c.json({ error: "Project not found" }, 404);

  const [knowledge, maintenance, openspec] = await Promise.all([
    checkFeature(name, "docs/knowledge/README.md"),
    checkFeature(name, "docs/knowledge/maintenance/README.md"),
    checkFeature(name, "openspec"),
  ]);
  return c.json({ knowledge, maintenance, openspec });
});

projects.post("/api/projects", async (c) => {
  const body = await c.req.json();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Project name required" }, 400);

  const createResult = await execInAiDev(`mkdir -p ~/workspace/${JSON.stringify(name)}`, 15_000);
  if (createResult.exitCode !== 0) {
    return c.json({ error: createResult.stderr || "Failed to create directory" }, 500);
  }

  // Register in OpenChamber so it appears automatically without manual "Add project"
  await execInAiDev(
    `SETTINGS=/home/devuser/.config/openchamber/settings.json && ` +
    `FULLPATH=/home/devuser/workspace/${JSON.stringify(name)} && ` +
    `ID=path_$(printf '%s' "$FULLPATH" | base64 -w0) && ` +
    `NOW=$(date +%s%3N) && ` +
    `jq --arg path "$FULLPATH" --arg id "$ID" --arg now "$NOW" ` +
    `'.projects += [{"id": $id, "path": $path, "addedAt": $now | tonumber, "lastOpenedAt": $now | tonumber}]' ` +
    `$SETTINGS > /tmp/settings.json && mv /tmp/settings.json $SETTINGS`,
    10_000,
  );

  return c.json({ ok: true });
});

projects.post("/api/projects/:name/features/:feature", async (c) => {
  const name = c.req.param("name");
  const feature = c.req.param("feature") as Feature;

  if (!FEATURES.includes(feature)) {
    return c.json({ error: `Unknown feature '${feature}'. Valid: ${FEATURES.join(", ")}` }, 400);
  }

  const PROJECT_ROOT = `/home/devuser/workspace/${JSON.stringify(name)}`;
  let cmd = "";
  switch (feature) {
    case "knowledge":
      cmd = `bash ~/.config/opencode/skills/enable-project-knowledge/bootstrap.sh ${PROJECT_ROOT}`;
      break;
    case "maintenance":
      cmd = `bash ~/.config/opencode/skills/enable-finalize-maintenance/bootstrap.sh ${PROJECT_ROOT}`;
      break;
    case "openspec":
      cmd = `openspec init --tools opencode --force ${PROJECT_ROOT}`;
      break;
  }

  const result = await execInAiDev(cmd, 30_000);
  if (result.exitCode !== 0 && result.exitCode !== -1) {
    return c.json({ error: result.stderr || "Feature enable failed" }, 500);
  }
  return c.json({ ok: true, output: result.stdout });
});

projects.get("/projects", async (c) => {
  const list = await listProjects();
  return c.html(ProjectsPage(list));
});

export default projects;
