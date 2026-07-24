import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { ProjectsPage } from "../views/projects";

const projects = new Hono();

async function listProjects(): Promise<string[]> {
  const result = await execInAiDev("ls ~/workspace/ 2>/dev/null || echo ''", 10_000);
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean);
}

projects.get("/api/projects", async (c) => {
  const list = await listProjects();
  return c.json(list);
});

projects.post("/api/projects", async (c) => {
  const body = await c.req.json();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Project name required" }, 400);

  const createResult = await execInAiDev(`mkdir -p ~/workspace/${JSON.stringify(name)}`, 15_000);
  if (createResult.exitCode !== 0) {
    return c.json({ error: createResult.stderr || "Failed to create directory" }, 500);
  }

  if (body.init_opencode) {
    await execInAiDev(
      `cd ~/workspace/${JSON.stringify(name)} && opencode --new 2>/dev/null || true`,
      30_000,
    );
  }

  return c.json({ ok: true });
});

projects.post("/api/projects/:name/init", async (c) => {
  const name = c.req.param("name");
  const result = await execInAiDev(
    `cd ~/workspace/${JSON.stringify(name)} && opencode --new 2>/dev/null || true`,
    30_000,
  );
  if (result.exitCode !== 0) {
    return c.json({ error: result.stderr || "Failed to initialize" }, 500);
  }
  return c.json({ ok: true });
});

projects.get("/projects", async (c) => {
  const list = await listProjects();
  return c.html(ProjectsPage(list));
});

export default projects;
