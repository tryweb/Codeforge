import { Hono } from "hono";
import {
  isValidProjectName,
  mergeOpenChamberProject,
  projectId,
  readOpenChamberProjects,
  type SettingsCommand,
} from "../lib/openchamber-projects";

export interface ProjectSyncRoutesOptions {
  command: SettingsCommand;
  settingsPath: string;
  workspaceRoot: string;
  listProjects: () => Promise<string[]>;
}

export function createProjectSyncRoutes(options: ProjectSyncRoutesOptions) {
  const { command, settingsPath, workspaceRoot, listProjects } = options;
  const sync = new Hono();

  sync.get("/api/projects/sync", async (c) => {
    const [workspaceDirs, ocProjects] = await Promise.all([
      listProjects(),
      readOpenChamberProjects(command, settingsPath, workspaceRoot),
    ]);
    const workspaceSet = new Set(workspaceDirs);
    const ocSet = new Set(ocProjects);

    const missingInOC = workspaceDirs.filter(d => !ocSet.has(d));
    const staleInOC = ocProjects.filter(d => !workspaceSet.has(d));

    return c.json({ missingInOC, staleInOC });
  });

  sync.post("/api/projects/sync", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Request body must be an object" }, 400);
    }
    const record = body as Record<string, unknown>;

    const toNames = (value: unknown): string[] | null => {
      if (value === undefined) return [];
      if (!Array.isArray(value)) return null;
      const names: string[] = [];
      for (const item of value) {
        if (typeof item !== "string" || !isValidProjectName(item.trim())) return null;
        names.push(item.trim());
      }
      return names;
    };
    const add = toNames(record.add);
    const remove = toNames(record.remove);
    if (!add || !remove) {
      return c.json({ error: "add/remove must be arrays of valid project names" }, 400);
    }

    const messages: string[] = [];
    const failures: string[] = [];
    for (const name of add) {
      const fullPath = `${workspaceRoot}/${name}`;
      const merged = await mergeOpenChamberProject(command, settingsPath, {
        kind: "add",
        id: projectId(fullPath),
        path: fullPath,
        now: Date.now(),
      });
      if (merged.ok) messages.push(`Added ${name} to OpenChamber`);
      else failures.push(`Failed to add ${name}: ${merged.error}`);
    }
    for (const name of remove) {
      const fullPath = `${workspaceRoot}/${name}`;
      const merged = await mergeOpenChamberProject(command, settingsPath, {
        kind: "remove",
        id: projectId(fullPath),
        path: fullPath,
      });
      if (merged.ok) messages.push(`Removed ${name} from OpenChamber`);
      else failures.push(`Failed to remove ${name}: ${merged.error}`);
    }

    if (failures.length > 0) {
      return c.json({ error: failures.join("; "), messages }, 500);
    }
    return c.json({ ok: true, messages });
  });

  return sync;
}
