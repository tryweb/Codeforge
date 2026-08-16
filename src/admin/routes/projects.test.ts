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
  directory: string;
  settingsPath: string;
  disabledPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

async function fixture(seed?: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "projects-routes-"));
  const settingsPath = join(directory, "settings.json");
  const disabledPath = join(directory, "disabled-projects.json");
  const workspaceRoot = join(directory, "workspace");
  if (seed !== undefined) await writeFile(settingsPath, seed);
  return {
    directory,
    settingsPath,
    disabledPath,
    workspaceRoot,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function appFor(f: Fixture, command: ProjectCommand = createCommand()) {
  return createProjectRoutes({ command, settingsPath: f.settingsPath, disabledPath: f.disabledPath, workspaceRoot: f.workspaceRoot });
}

function createProject(app: ReturnType<typeof createProjectRoutes>, name: string) {
  return app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, git_init: false }),
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

describe("POST /api/projects OpenChamber registration", () => {
  test("registers the project when settings have no projects key", async () => {
    const f = await fixture('{"showOpenCodeUpdateNotifications":true}\n');
    try {
      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      const settings = await readSettings(f);
      expect(settings.showOpenCodeUpdateNotifications).toBe(true);
      const fullPath = `${f.workspaceRoot}/demo`;
      expect(settings.projects).toHaveLength(1);
      expect(settings.projects?.[0]?.id).toBe(projectId(fullPath));
      expect(settings.projects?.[0]?.path).toBe(fullPath);
      expect(typeof settings.projects?.[0]?.addedAt).toBe("number");
      expect(typeof settings.projects?.[0]?.lastOpenedAt).toBe("number");
    } finally {
      await f.cleanup();
    }
  });

  test("creates the settings file when it is missing", async () => {
    const f = await fixture();
    try {
      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      const settings = await readSettings(f);
      expect(settings.projects?.map((p) => p.path)).toEqual([`${f.workspaceRoot}/demo`]);
    } finally {
      await f.cleanup();
    }
  });

  test("preserves unrelated keys and existing projects", async () => {
    const existing: StoredProject = { id: "path_other", path: "/somewhere/else", addedAt: 1, lastOpenedAt: 2 };
    const f = await fixture(JSON.stringify({ theme: "dark", projects: [existing] }) + "\n");
    try {
      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(200);

      const settings = await readSettings(f);
      expect(settings.theme).toBe("dark");
      expect(settings.projects).toHaveLength(2);
      expect(settings.projects?.[0]).toEqual(existing);
      expect(settings.projects?.[1]?.path).toBe(`${f.workspaceRoot}/demo`);
    } finally {
      await f.cleanup();
    }
  });

  test("does not duplicate an already registered project", async () => {
    const f = await fixture();
    try {
      const fullPath = `${f.workspaceRoot}/demo`;
      const seeded: StoredProject = { id: projectId(fullPath), path: fullPath, addedAt: 1, lastOpenedAt: 1 };
      await writeFile(f.settingsPath, JSON.stringify({ projects: [seeded] }) + "\n");

      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(200);

      const settings = await readSettings(f);
      expect(settings.projects?.filter((p) => p.path === fullPath)).toHaveLength(1);
      expect(settings.projects?.filter((p) => p.id === projectId(fullPath))).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });

  test("re-registering preserves existing metadata and collapses duplicates", async () => {
    const f = await fixture();
    try {
      const fullPath = `${f.workspaceRoot}/demo`;
      const seeded: StoredProject = {
        id: projectId(fullPath),
        path: fullPath,
        label: "Demo",
        icon: "rocket",
        color: "#ff0000",
        defaultModel: "gpt-5",
        iconImage: "data:image/png;base64,xyz",
        sidebarCollapsed: true,
        addedAt: 1,
        lastOpenedAt: 1,
      };
      const duplicate: StoredProject = { id: "path_stale", path: fullPath, addedAt: 2, lastOpenedAt: 2 };
      const other: StoredProject = { id: "path_other", path: "/somewhere/else", addedAt: 3, lastOpenedAt: 3 };
      await writeFile(f.settingsPath, JSON.stringify({ theme: "dark", projects: [seeded, duplicate, other] }) + "\n");

      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(200);

      const settings = await readSettings(f);
      expect(settings.theme).toBe("dark");
      expect(settings.projects).toHaveLength(2);
      const matches = settings.projects?.filter((p) => p.path === fullPath || p.id === projectId(fullPath)) ?? [];
      expect(matches).toHaveLength(1);
      const survivor = matches[0];
      expect(survivor?.id).toBe(projectId(fullPath));
      expect(survivor?.label).toBe("Demo");
      expect(survivor?.icon).toBe("rocket");
      expect(survivor?.color).toBe("#ff0000");
      expect(survivor?.defaultModel).toBe("gpt-5");
      expect(survivor?.iconImage).toBe("data:image/png;base64,xyz");
      expect(survivor?.sidebarCollapsed).toBe(true);
      expect(survivor?.addedAt).toBe(1);
      expect(typeof survivor?.lastOpenedAt).toBe("number");
      expect(survivor?.lastOpenedAt).not.toBe(1);
      expect(settings.projects?.some((p) => p.id === "path_stale")).toBe(false);
      expect(settings.projects?.[1]).toEqual(other);
    } finally {
      await f.cleanup();
    }
  });

  test("registers via an atomic temp-file write", async () => {
    const f = await fixture();
    let invoked = "";
    const command: ProjectCommand = async (source) => {
      if (source.includes("SETTINGS=")) invoked = source;
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      const response = await createProject(appFor(f, command), "demo");
      expect(response.status).toBe(200);
      expect(invoked).toContain("mktemp");
      expect(invoked).toContain("umask 077");
      expect(invoked).toContain("--arg path");
      expect(invoked).toContain(".projects // []");
      expect(invoked).not.toContain("/tmp/settings.json");
    } finally {
      await f.cleanup();
    }
  });
});

async function readDisabled(f: Fixture): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(f.disabledPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const disabled = (parsed as Record<string, unknown>).disabled;
  if (!Array.isArray(disabled)) return [];
  return disabled.filter((n): n is string => typeof n === "string");
}

describe("POST /api/projects/:name/disable and enable", () => {
  /** Runs real shell for directory checks, project listing, and both state files. */
  function realCommand(): ProjectCommand {
    return async (source) => source.includes("jq") || source.includes("find ") || source.includes("test -d")
      ? shellCommand(source)
      : { exitCode: 0, stdout: "", stderr: "" };
  }

  function requestDisable(app: ReturnType<typeof createProjectRoutes>, name: string) {
    return app.request(`http://localhost/api/projects/${encodeURIComponent(name)}/disable`, { method: "POST" });
  }

  function requestEnable(app: ReturnType<typeof createProjectRoutes>, name: string) {
    return app.request(`http://localhost/api/projects/${encodeURIComponent(name)}/enable`, { method: "POST" });
  }

  test("disable removes the OpenChamber registration and marks the project", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.workspaceRoot, "demo"), { recursive: true });
      const fullPath = `${f.workspaceRoot}/demo`;
      await writeFile(f.settingsPath, JSON.stringify({
        projects: [{ id: projectId(fullPath), path: fullPath, addedAt: 1, lastOpenedAt: 1 }],
      }) + "\n");

      const response = await requestDisable(appFor(f, realCommand()), "demo");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      expect((await readSettings(f)).projects).toEqual([]);
      expect(await readDisabled(f)).toEqual(["demo"]);
    } finally {
      await f.cleanup();
    }
  });

  test("enable re-registers the project and unmarks it", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.workspaceRoot, "demo"), { recursive: true });
      await writeFile(f.disabledPath, JSON.stringify({ disabled: ["demo"] }) + "\n");

      const response = await requestEnable(appFor(f, realCommand()), "demo");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      expect((await readSettings(f)).projects?.map((p) => p.path)).toEqual([`${f.workspaceRoot}/demo`]);
      expect(await readDisabled(f)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  test("disable rolls back the disabled mark when unregistration fails", async () => {
    const f = await fixture();
    const command: ProjectCommand = async (source) => {
      if (source.includes("jq") && source.includes("DISABLED=")) return shellCommand(source);
      if (source.includes("SETTINGS=")) return { exitCode: 1, stdout: "", stderr: "settings boom" };
      if (source.includes("test -d")) return shellCommand(source);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      await mkdir(join(f.workspaceRoot, "demo"), { recursive: true });

      const response = await requestDisable(appFor(f, command), "demo");
      expect(response.status).toBe(500);
      const body = await response.json() as Record<string, unknown>;
      expect(String(body.error)).toContain("settings boom");
      expect(await readDisabled(f)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  test("disable requires an existing project directory", async () => {
    const f = await fixture();
    try {
      const response = await requestDisable(appFor(f, realCommand()), "ghost");
      expect(response.status).toBe(404);
    } finally {
      await f.cleanup();
    }
  });
});

describe("GET /api/projects/overview tool status", () => {
  /** Runs real shell for listing, feature checks, and state files; fakes probes and git. */
  function overviewCommand(): ProjectCommand {
    return async (source) => source.includes("jq") || source.includes("find ") || source.includes("test -e") || source.includes("test -d")
      ? shellCommand(source)
      : { exitCode: 0, stdout: "", stderr: "" };
  }

  test("passes codegraph through from the shared provider", async () => {
    const f = await fixture();
    const toolStatus = {
      probe: async () => ({
        codegraph: { initialized: true, nodeCount: 42 },
      }),
      probeSite: async () => null,
      probeGain: async () => null,
      invalidate: () => {},
    };
    try {
      await mkdir(join(f.workspaceRoot, "demo"), { recursive: true });
      const app = createProjectRoutes({
        command: overviewCommand(),
        settingsPath: f.settingsPath,
        disabledPath: f.disabledPath,
        workspaceRoot: f.workspaceRoot,
        toolStatus,
      });

      const res = await app.request("http://localhost/api/projects/overview");
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const demo = body["demo"] as Record<string, unknown>;
      expect(demo.codegraph).toEqual({ initialized: true, nodeCount: 42 });
      expect(demo.features).toEqual({ knowledge: false, maintenance: false, openspec: false });
      expect(demo.disabled).toBe(false);
      expect(demo.remote).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  test("yields null codegraph when default probes find nothing", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.workspaceRoot, "demo"), { recursive: true });
      const app = createProjectRoutes({
        command: overviewCommand(),
        settingsPath: f.settingsPath,
        disabledPath: f.disabledPath,
        workspaceRoot: f.workspaceRoot,
      });

      const res = await app.request("http://localhost/api/projects/overview");
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const demo = body["demo"] as Record<string, unknown>;
      expect(demo.codegraph).toBeNull();
      expect(demo.features).toEqual({ knowledge: false, maintenance: false, openspec: false });
    } finally {
      await f.cleanup();
    }
  });

  test("POST /api/projects/tool-status/refresh invalidates the shared provider cache", async () => {
    const f = await fixture();
    let invalidations = 0;
    const toolStatus = {
      probe: async () => ({ codegraph: null }),
      probeSite: async () => null,
      probeGain: async () => null,
      invalidate: () => { invalidations += 1; },
    };
    try {
      await mkdir(join(f.workspaceRoot, "demo"), { recursive: true });
      const app = createProjectRoutes({
        command: overviewCommand(),
        settingsPath: f.settingsPath,
        disabledPath: f.disabledPath,
        workspaceRoot: f.workspaceRoot,
        toolStatus,
      });

      const res = await app.request("http://localhost/api/projects/tool-status/refresh", { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(invalidations).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
});
