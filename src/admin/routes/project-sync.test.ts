import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectRoutes, type ProjectCommand } from "./projects";

async function shellCommand(source: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["sh", "-c", source], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Runs the real settings/disabled-state merge shell locally; fakes every other ai-dev command. */
function createCommand(): ProjectCommand {
  return async (source) => source.includes("SETTINGS=") || source.includes("DISABLED=")
    ? shellCommand(source)
    : { exitCode: 0, stdout: "", stderr: "" };
}

interface Fixture {
  settingsPath: string;
  disabledPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "project-sync-"));
  return {
    settingsPath: join(directory, "settings.json"),
    disabledPath: join(directory, "disabled-projects.json"),
    workspaceRoot: join(directory, "workspace"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function appFor(f: Fixture, command: ProjectCommand = createCommand()) {
  return createProjectRoutes({ command, settingsPath: f.settingsPath, disabledPath: f.disabledPath, workspaceRoot: f.workspaceRoot });
}

function syncProjects(app: ReturnType<typeof createProjectRoutes>, payload: unknown) {
  return app.request("http://localhost/api/projects/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function projectId(fullPath: string): string {
  return "path_" + Buffer.from(fullPath).toString("base64");
}

interface StoredProject {
  id: string;
  path: string;
  addedAt?: number;
  lastOpenedAt?: number;
  label?: string;
  icon?: string;
  color?: string;
  defaultModel?: string;
  iconImage?: string;
  sidebarCollapsed?: boolean;
}

interface StoredSettings {
  projects?: StoredProject[];
  [key: string]: unknown;
}

async function readSettings(f: Fixture): Promise<StoredSettings> {
  const parsed: unknown = JSON.parse(await readFile(f.settingsPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("settings file is not an object");
  }
  return parsed as StoredSettings;
}

describe("POST /api/projects/sync", () => {
  test("adds and removes projects whose names contain spaces and punctuation", async () => {
    const f = await fixture();
    try {
      const staleName = "old project-1.0_x";
      const stalePath = `${f.workspaceRoot}/${staleName}`;
      await writeFile(f.settingsPath, JSON.stringify({
        theme: "dark",
        projects: [{ id: projectId(stalePath), path: stalePath, addedAt: 1, lastOpenedAt: 1 }],
      }) + "\n");

      const newName = "new project-2.0_beta";
      const response = await syncProjects(appFor(f), { add: [newName], remove: [staleName] });
      expect(response.status).toBe(200);
      expect((await response.json() as Record<string, unknown>).ok).toBe(true);

      const settings = await readSettings(f);
      expect(settings.theme).toBe("dark");
      const newPath = `${f.workspaceRoot}/${newName}`;
      expect(settings.projects).toHaveLength(1);
      expect(settings.projects?.[0]?.path).toBe(newPath);
      expect(settings.projects?.[0]?.id).toBe(projectId(newPath));
    } finally {
      await f.cleanup();
    }
  });

  test("sync add preserves metadata of an already registered project", async () => {
    const f = await fixture();
    try {
      const fullPath = `${f.workspaceRoot}/demo`;
      const seeded: StoredProject = {
        id: projectId(fullPath),
        path: fullPath,
        label: "Demo",
        color: "blue",
        defaultModel: "gpt-5",
        sidebarCollapsed: false,
        addedAt: 1,
        lastOpenedAt: 1,
      };
      await writeFile(f.settingsPath, JSON.stringify({ projects: [seeded] }) + "\n");

      const response = await syncProjects(appFor(f), { add: ["demo"] });
      expect(response.status).toBe(200);

      const settings = await readSettings(f);
      expect(settings.projects).toHaveLength(1);
      const survivor = settings.projects?.[0];
      expect(survivor?.id).toBe(projectId(fullPath));
      expect(survivor?.label).toBe("Demo");
      expect(survivor?.color).toBe("blue");
      expect(survivor?.defaultModel).toBe("gpt-5");
      expect(survivor?.sidebarCollapsed).toBe(false);
      expect(survivor?.addedAt).toBe(1);
      expect(typeof survivor?.lastOpenedAt).toBe("number");
      expect(survivor?.lastOpenedAt).not.toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  test("creates the settings file when it is missing", async () => {
    const f = await fixture();
    try {
      const response = await syncProjects(appFor(f), { add: ["demo"] });
      expect(response.status).toBe(200);

      const settings = await readSettings(f);
      expect(settings.projects?.map((p) => p.path)).toEqual([`${f.workspaceRoot}/demo`]);
    } finally {
      await f.cleanup();
    }
  });

  test("returns 500 without reporting ok when a sync write fails", async () => {
    const f = await fixture();
    const command: ProjectCommand = async (source) => source.includes("SETTINGS=")
      ? { exitCode: 1, stdout: "", stderr: "sync boom" }
      : { exitCode: 0, stdout: "", stderr: "" };
    try {
      const response = await syncProjects(appFor(f, command), { add: ["demo"] });
      expect(response.status).toBe(500);
      const body = await response.json() as Record<string, unknown>;
      expect(body.ok).toBeUndefined();
      expect(String(body.error)).toContain("sync boom");
    } finally {
      await f.cleanup();
    }
  });

  test("rejects invalid names in sync requests before running any command", async () => {
    const f = await fixture();
    const invoked: string[] = [];
    const command: ProjectCommand = async (source) => {
      invoked.push(source);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      const response = await syncProjects(appFor(f, command), { add: ["../evil"] });
      expect(response.status).toBe(400);
      expect(invoked).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  test("removes via jq arguments instead of interpolating the path", async () => {
    const f = await fixture();
    const invoked: string[] = [];
    const command: ProjectCommand = async (source) => {
      if (source.includes("SETTINGS=")) invoked.push(source);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      const response = await syncProjects(appFor(f, command), { remove: ["demo"] });
      expect(response.status).toBe(200);
      expect(invoked).toHaveLength(1);
      expect(invoked[0]).toContain("--arg path");
      expect(invoked[0]).not.toContain('select(.path == "');
    } finally {
      await f.cleanup();
    }
  });
});

describe("GET /api/projects/sync", () => {
  /** Runs the real directory listing and both state files locally. */
  function realCommand(): ProjectCommand {
    return async (source) => source.includes("jq") || source.includes("find ")
      ? shellCommand(source)
      : { exitCode: 0, stdout: "", stderr: "" };
  }

  test("excludes disabled projects from missingInOC", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.workspaceRoot, "registered"), { recursive: true });
      await mkdir(join(f.workspaceRoot, "disabled-proj"), { recursive: true });
      await writeFile(f.settingsPath, JSON.stringify({
        projects: [{ id: projectId(`${f.workspaceRoot}/registered`), path: `${f.workspaceRoot}/registered`, addedAt: 1, lastOpenedAt: 1 }],
      }) + "\n");
      await writeFile(f.disabledPath, JSON.stringify({ disabled: ["disabled-proj"] }) + "\n");

      const response = await appFor(f, realCommand()).request("http://localhost/api/projects/sync");
      expect(response.status).toBe(200);
      const body = await response.json() as { missingInOC: string[]; staleInOC: string[] };
      expect(body.missingInOC).toEqual([]);
      expect(body.staleInOC).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  test("reports unregistered non-disabled projects as missing", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.workspaceRoot, "plain"), { recursive: true });

      const response = await appFor(f, realCommand()).request("http://localhost/api/projects/sync");
      expect(response.status).toBe(200);
      const body = await response.json() as { missingInOC: string[]; staleInOC: string[] };
      expect(body.missingInOC).toEqual(["plain"]);
    } finally {
      await f.cleanup();
    }
  });
});
