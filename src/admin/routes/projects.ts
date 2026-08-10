import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import {
  isValidProjectName,
  mergeDisabledProject,
  mergeOpenChamberProject,
  projectId,
} from "../lib/openchamber-projects";
import {
  checkFeature,
  collectProjectOverviews,
  listProjects,
  type ProjectCommand,
} from "../lib/projects-overview";
import { createProjectSyncRoutes } from "./project-sync";
import { ProjectsPage } from "../views/projects";

export type { ProjectCommand };

const FEATURES = ["knowledge", "maintenance", "openspec"] as const;
type Feature = (typeof FEATURES)[number];

export interface ProjectRoutesOptions {
  command?: ProjectCommand;
  settingsPath?: string;
  disabledPath?: string;
  workspaceRoot?: string;
}

const DEFAULT_WORKSPACE_ROOT = "/home/devuser/workspace";
const DEFAULT_OPENCHAMBER_SETTINGS = "/home/devuser/.config/openchamber/settings.json";
const DEFAULT_OPENCHAMBER_DISABLED = "/home/devuser/.config/openchamber/disabled-projects.json";

export function createProjectRoutes(options: ProjectRoutesOptions = {}) {
  const command = options.command ?? execInAiDev;
  const settingsPath = options.settingsPath ?? DEFAULT_OPENCHAMBER_SETTINGS;
  const disabledPath = options.disabledPath ?? DEFAULT_OPENCHAMBER_DISABLED;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;

  const projects = new Hono();
  const projectDir = (name: string) => JSON.stringify(`${workspaceRoot}/${name}`);

  projects.get("/api/projects", async (c) => {
    const list = await listProjects(command, workspaceRoot);
    return c.json(list);
  });

  projects.get("/api/projects/overview", async (c) => {
    const overviews = await collectProjectOverviews(command, workspaceRoot, settingsPath, disabledPath);
    const data: Record<string, { features: { knowledge: boolean; maintenance: boolean; openspec: boolean }; remote: string | null; disabled: boolean }> = {};
    for (const overview of overviews) {
      data[overview.name] = {
        features: overview.features,
        remote: overview.remote,
        disabled: overview.disabled,
      };
    }
    return c.json(data);
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

    const remote = body.git_remote?.trim();

    // Git setup: clone remote or init local (always writes .gitignore)
    if (body.git_init && remote) {
      const cloneResult = await command(
        `git clone --depth 1 ${JSON.stringify(remote)} ${projectDir(name)} 2>&1`,
        120_000,
      );
      if (cloneResult.exitCode !== 0 && cloneResult.exitCode !== -1) {
        const msg = cloneResult.stderr || cloneResult.stdout || "clone failed";
        return c.json({ error: `Clone failed. Make sure the URL is correct and git auth is configured (see GitHub/GitLab Auth page). Details: ${msg}` }, 500);
      }
      // Append AI-EngKit entries to cloned repo's existing .gitignore
      await command(
        `cd ${projectDir(name)} && ` +
        `grep -qs '^\\.omo/' .gitignore 2>/dev/null || ` +
        `printf '\\n# AI-EngKit system directories\\n.omo/\\n.playwright-mcp/\\n.codegraph/\\n.sisyphus/\\n.tmp/\\n.env\\nnode_modules/\\nbackups/\\n' >> .gitignore`,
        10_000,
      );
    } else if (body.git_init) {
      // New local project with git init
      const createResult = await command(`mkdir -p ${projectDir(name)}`, 15_000);
      if (createResult.exitCode !== 0) {
        return c.json({ error: createResult.stderr || "Failed to create directory" }, 500);
      }
      const initResult = await command(
        `cd ${projectDir(name)} && git init 2>&1`, 10_000,
      );
      if (initResult.exitCode !== 0 && initResult.exitCode !== -1) {
        return c.json({ error: `git init failed: ${initResult.stderr || initResult.stdout}` }, 500);
      }
      // Write .gitignore BEFORE initial commit so it gets tracked
      await command(
        `cd ${projectDir(name)} && ` +
        `printf '%s\\n' '' '# AI-EngKit system directories' '.omo/' '.playwright-mcp/' '.codegraph/' '.sisyphus/' '.tmp/' '.env' 'node_modules/' 'backups/' > .gitignore`,
        10_000,
      );
      await command(
        `cd ${projectDir(name)} && git add -A && git commit -m "Initial commit" 2>/dev/null || true`,
        10_000,
      );
    } else {
      const createResult = await command(`mkdir -p ${projectDir(name)}`, 15_000);
      if (createResult.exitCode !== 0) {
        return c.json({ error: createResult.stderr || "Failed to create directory" }, 500);
      }
    }

    // Recreating a project clears any previous disabled state so the disabled
    // list never masks a project the user just created.
    const reenabled = await mergeDisabledProject(command, disabledPath, name, "enable");
    if (!reenabled.ok) {
      return c.json({ error: `Project created, but its disabled state could not be cleared: ${reenabled.error}` }, 500);
    }

    // Register in OpenChamber so it appears automatically without manual "Add project".
    // A registration failure is reported: the project exists on disk but is not registered.
    const fullPath = `${workspaceRoot}/${name}`;
    const registration = await mergeOpenChamberProject(command, settingsPath, {
      kind: "add",
      id: projectId(fullPath),
      path: fullPath,
      now: Date.now(),
    });
    if (!registration.ok) {
      return c.json({ error: `Project created, but OpenChamber registration failed: ${registration.error}` }, 500);
    }

    return c.json({ ok: true });
  });

  projects.post("/api/projects/:name/features/:feature", async (c) => {
    const name = c.req.param("name");
    const feature = c.req.param("feature") as Feature;

    if (!FEATURES.includes(feature)) {
      return c.json({ error: `Unknown feature '${feature}'. Valid: ${FEATURES.join(", ")}` }, 400);
    }

    const PROJECT_ROOT = projectDir(name);
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

    const result = await command(cmd, 30_000);
    if (result.exitCode !== 0 && result.exitCode !== -1) {
      return c.json({ error: result.stderr || "Feature enable failed" }, 500);
    }
    return c.json({ ok: true, output: result.stdout });
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
    const url = body.remote?.trim();
    const base = `cd ${projectDir(name)}`;

    if (!url) {
      await command(`${base} && git remote remove origin 2>/dev/null || true`, 10_000);
      return c.json({ ok: true });
    }

    // Auto-init if not yet a git repo
    await command(`${base} && git init 2>/dev/null || true`, 10_000);

    const hasRemote = await command(
      `${base} && git remote get-url origin 2>/dev/null || echo "no-remote"`, 10_000,
    );
    const isNewRemote = hasRemote.stdout.trim() === "no-remote";
    const setCmd = isNewRemote
      ? `${base} && git remote add origin ${JSON.stringify(url)}`
      : `${base} && git remote set-url origin ${JSON.stringify(url)}`;

    const setResult = await command(setCmd, 10_000);
    if (setResult.exitCode !== 0 && setResult.exitCode !== -1) {
      return c.json({ error: setResult.stderr || "Failed to set git remote" }, 500);
    }

    const hasCommits = await command(
      `${base} && git cat-file -t HEAD 2>/dev/null || true`, 5_000,
    );
    if (hasCommits.stdout.trim() !== "commit") {
      const fetch = await command(
        `${base} && git fetch origin --depth 1 2>&1`, 120_000,
      );
      if (fetch.exitCode !== 0 && fetch.exitCode !== -1) {
        return c.json({ error: `Remote set, but fetch failed: ${fetch.stderr || fetch.stdout || "unknown"}`, partial: true }, 500);
      }
      // Try checkout, force to handle untracked files from features (knowledge, openspec, etc.)
      const checkout = await command(
        `${base} && (git checkout -f --track origin/main 2>/dev/null || git checkout -f --track origin/master 2>/dev/null || true)`,
        30_000,
      );
      if (checkout.exitCode !== 0 && checkout.exitCode !== -1) {
        const msg = checkout.stderr || checkout.stdout || "checkout failed";
        return c.json({ error: `Remote set and fetched, but checkout failed: ${msg}`, partial: true }, 500);
      }
    }

    return c.json({ ok: true });
  });

  projects.route("/", createProjectSyncRoutes({ command, settingsPath, disabledPath, workspaceRoot, listProjects: () => listProjects(command, workspaceRoot) }));

  projects.post("/api/projects/:name/disable", async (c) => {
    const name = c.req.param("name");
    if (!isValidProjectName(name)) return c.json({ error: "Invalid project name" }, 400);

    const exists = await command(`test -d ${projectDir(name)} && echo yes`, 5_000);
    if (exists.stdout.trim() !== "yes") return c.json({ error: "Project not found" }, 404);

    const marked = await mergeDisabledProject(command, disabledPath, name, "disable");
    if (!marked.ok) {
      return c.json({ error: `Could not disable project: ${marked.error}` }, 500);
    }

    const fullPath = `${workspaceRoot}/${name}`;
    const removed = await mergeOpenChamberProject(command, settingsPath, {
      kind: "remove",
      id: projectId(fullPath),
      path: fullPath,
    });
    if (!removed.ok) {
      // Roll the disabled mark back so the state file stays consistent with
      // OpenChamber: the project remains visible and a retry is safe.
      await mergeDisabledProject(command, disabledPath, name, "enable");
      return c.json({ error: `Could not unregister project from OpenChamber: ${removed.error}`, partial: true }, 500);
    }
    return c.json({ ok: true });
  });

  projects.post("/api/projects/:name/enable", async (c) => {
    const name = c.req.param("name");
    if (!isValidProjectName(name)) return c.json({ error: "Invalid project name" }, 400);

    const exists = await command(`test -d ${projectDir(name)} && echo yes`, 5_000);
    if (exists.stdout.trim() !== "yes") return c.json({ error: "Project not found" }, 404);

    const unmarked = await mergeDisabledProject(command, disabledPath, name, "enable");
    if (!unmarked.ok) {
      return c.json({ error: `Could not enable project: ${unmarked.error}` }, 500);
    }

    const fullPath = `${workspaceRoot}/${name}`;
    const registered = await mergeOpenChamberProject(command, settingsPath, {
      kind: "add",
      id: projectId(fullPath),
      path: fullPath,
      now: Date.now(),
    });
    if (!registered.ok) {
      // The project is enabled but unregistered; the next reconcile pass
      // re-adds it automatically, so no rollback is needed.
      return c.json({ error: `Project enabled, but OpenChamber registration failed: ${registered.error}`, partial: true }, 500);
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
