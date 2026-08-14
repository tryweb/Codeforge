import { Hono } from "hono";
import {
  isValidProjectName,
  readDisabledProjects,
  readOpenChamberProjects,
  type SettingsCommand,
} from "../lib/openchamber-projects";
import { syncProjects } from "../lib/projects";

export interface ProjectSyncRoutesOptions {
  command: SettingsCommand;
  settingsPath: string;
  disabledPath: string;
  workspaceRoot: string;
  listProjects: () => Promise<string[]>;
}

export function createProjectSyncRoutes(options: ProjectSyncRoutesOptions) {
  const { command, settingsPath, disabledPath, workspaceRoot, listProjects } = options;
  const sync = new Hono();

  sync.get("/api/projects/sync", async (c) => {
    const [workspaceDirs, ocProjects, disabledProjects] = await Promise.all([
      listProjects(),
      readOpenChamberProjects(command, settingsPath, workspaceRoot),
      readDisabledProjects(command, disabledPath),
    ]);
    const workspaceSet = new Set(workspaceDirs);
    const ocSet = new Set(ocProjects);
    const disabledSet = new Set(disabledProjects);

    // Disabled projects stay out of missingInOC so "Fix All" cannot re-add them.
    const missingInOC = workspaceDirs.filter(d => !ocSet.has(d) && !disabledSet.has(d));
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

    const result = await syncProjects(add, remove, { command, settingsPath, workspaceRoot });
    if (!result.ok) {
      return c.json({ error: result.error, messages: result.messages ?? [] }, 500);
    }
    return c.json({ ok: true, messages: result.messages ?? [] });
  });

  return sync;
}
