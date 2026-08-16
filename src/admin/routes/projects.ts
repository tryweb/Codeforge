import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { createToolStatusProbe, type ProjectToolStatusProvider } from "../lib/project-tool-status";
import type { ProjectOverview } from "../lib/projects-overview";
import {
  checkFeature,
  collectProjectOverviews,
  createProject,
  disableProject,
  enableProject,
  enableProjectFeature,
  isValidProjectName,
  listProjects,
  PROJECT_FEATURES,
  setProjectRemote,
  type ProjectCommand,
} from "../lib/projects";
import { createProjectSyncRoutes } from "./project-sync";
import { ProjectsPage } from "../views/projects";

export type { ProjectCommand };

type Feature = (typeof PROJECT_FEATURES)[number];

export interface ProjectRoutesOptions {
  command?: ProjectCommand;
  settingsPath?: string;
  disabledPath?: string;
  workspaceRoot?: string;
  /** Test seam: inject a probe provider to stub codegraph/leanCTX status. */
  toolStatus?: ProjectToolStatusProvider;
}

const DEFAULT_WORKSPACE_ROOT = "/home/devuser/workspace";
const DEFAULT_OPENCHAMBER_SETTINGS = "/home/devuser/.config/openchamber/settings.json";
const DEFAULT_OPENCHAMBER_DISABLED = "/home/devuser/.config/openchamber/disabled-projects.json";

export function createProjectRoutes(options: ProjectRoutesOptions = {}) {
  const command = options.command ?? execInAiDev;
  const settingsPath = options.settingsPath ?? DEFAULT_OPENCHAMBER_SETTINGS;
  const disabledPath = options.disabledPath ?? DEFAULT_OPENCHAMBER_DISABLED;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;

  // One shared provider per app instance: its cache is reused across overview
  // requests and invalidated after project sync mutates the project set.
  const toolStatus = options.toolStatus ?? createToolStatusProbe({ command, workspaceRoot });

  const projects = new Hono();
  const projectDir = (name: string) => JSON.stringify(`${workspaceRoot}/${name}`);

  projects.get("/api/projects", async (c) => {
    const list = await listProjects(command, workspaceRoot);
    return c.json(list);
  });

  projects.get("/api/projects/overview", async (c) => {
    const overviews = await collectProjectOverviews(command, workspaceRoot, settingsPath, disabledPath, toolStatus);
    const data: Record<string, {
      features: { knowledge: boolean; maintenance: boolean; openspec: boolean };
      remote: string | null;
      disabled: boolean;
      codegraph: ProjectOverview["codegraph"];
    }> = {};
    for (const overview of overviews) {
      data[overview.name] = {
        features: overview.features,
        remote: overview.remote,
        disabled: overview.disabled,
        codegraph: overview.codegraph ?? null,
      };
    }
    return c.json(data);
  });

  projects.post("/api/projects/tool-status/refresh", async (c) => {
    toolStatus.invalidate();
    return c.json({ ok: true });
  });

  projects.get("/api/projects/:name/features", async (c) => {
    const name = c.req.param("name");
    if (!name || name.includes("..")) return c.json({ error: "Invalid project name" }, 400);

    // Verify project exists
    const exists = await command(`test -d ${projectDir(name)} && echo yes`, 5_000);
    if (exists.stdout.trim() !== "yes") return c.json({ error: "Project not found" }, 404);

    const [knowledge, maintenance, openspec] = await Promise.all([
      checkFeature(command, workspaceRoot, name, "docs/knowledge/README.md"),
      checkFeature(command, workspaceRoot, name, "docs/knowledge/maintenance/README.md"),
      checkFeature(command, workspaceRoot, name, "openspec"),
    ]);
    return c.json({ knowledge, maintenance, openspec });
  });

  projects.post("/api/projects", async (c) => {
    const body = await c.req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "Project name required" }, 400);
    if (!isValidProjectName(name)) {
      return c.json({ error: "Invalid project name: use letters, digits, spaces and . _ - (no path separators or '..')" }, 400);
    }

    const result = await createProject(
      name,
      { gitInit: !!body.git_init, gitRemote: typeof body.git_remote === "string" ? body.git_remote : undefined },
      { command, settingsPath, disabledPath, workspaceRoot },
    );
    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ ok: true });
  });

  projects.post("/api/projects/:name/features/:feature", async (c) => {
    const name = c.req.param("name");
    const feature = c.req.param("feature") as Feature;

    if (!PROJECT_FEATURES.includes(feature)) {
      return c.json({ error: `Unknown feature '${feature}'. Valid: ${PROJECT_FEATURES.join(", ")}` }, 400);
    }

    const result = await enableProjectFeature(name, feature, { command, workspaceRoot });
    if (!result.ok) return c.json({ error: result.error }, 500);
    return c.json({ ok: true, output: result.output ?? "" });
  });

  projects.get("/api/projects/:name/git-remote", async (c) => {
    const name = c.req.param("name");
    const r = await command(
      `cd ${projectDir(name)} && git remote get-url origin 2>/dev/null || true`,
      10_000,
    );
    return c.json({ remote: r.stdout.trim() || null });
  });

  projects.put("/api/projects/:name/git-remote", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json();
    const url = typeof body.remote === "string" ? body.remote : "";

    const result = await setProjectRemote(name, url, { command, settingsPath, disabledPath, workspaceRoot });
    if (!result.ok) {
      return c.json({ error: result.error, ...(result.partial ? { partial: true } : {}) }, 500);
    }
    return c.json({ ok: true });
  });

  projects.route("/", createProjectSyncRoutes({
    command,
    settingsPath,
    disabledPath,
    workspaceRoot,
    listProjects: () => listProjects(command, workspaceRoot),
    invalidateToolStatus: () => toolStatus.invalidate(),
  }));

  projects.post("/api/projects/:name/disable", async (c) => {
    const name = c.req.param("name");
    if (!isValidProjectName(name)) return c.json({ error: "Invalid project name" }, 400);

    const result = await disableProject(name, { command, settingsPath, disabledPath, workspaceRoot });
    if (!result.ok) {
      return c.json({ error: result.error, ...(result.partial ? { partial: true } : {}) }, result.status ?? 500);
    }
    return c.json({ ok: true });
  });

  projects.post("/api/projects/:name/enable", async (c) => {
    const name = c.req.param("name");
    if (!isValidProjectName(name)) return c.json({ error: "Invalid project name" }, 400);

    const result = await enableProject(name, { command, settingsPath, disabledPath, workspaceRoot });
    if (!result.ok) {
      return c.json({ error: result.error, ...(result.partial ? { partial: true } : {}) }, result.status ?? 500);
    }
    return c.json({ ok: true });
  });

  projects.get("/projects", async (c) => {
    const list = await listProjects(command, workspaceRoot);
    return c.html(ProjectsPage(list));
  });

  return projects;
}

export default createProjectRoutes();
