import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** Runs the real settings-merge shell locally; fakes every other ai-dev command. */
function createCommand(): ProjectCommand {
  return async (source) => source.includes("SETTINGS=")
    ? shellCommand(source)
    : { exitCode: 0, stdout: "", stderr: "" };
}

interface Fixture {
  settingsPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

async function fixture(seed?: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "projects-guard-"));
  const settingsPath = join(directory, "settings.json");
  const workspaceRoot = join(directory, "workspace");
  if (seed !== undefined) await writeFile(settingsPath, seed);
  return {
    settingsPath,
    workspaceRoot,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function appFor(f: Fixture, command: ProjectCommand = createCommand()) {
  return createProjectRoutes({ command, settingsPath: f.settingsPath, workspaceRoot: f.workspaceRoot });
}

function createProject(app: ReturnType<typeof createProjectRoutes>, name: string) {
  return app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, git_init: false }),
  });
}

describe("POST /api/projects registration guard rails", () => {
  test("fails without clobbering malformed settings JSON", async () => {
    const original = "this is not json\n";
    const f = await fixture(original);
    try {
      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(500);
      const body = await response.json() as Record<string, unknown>;
      expect(body.ok).toBeUndefined();
      expect(typeof body.error).toBe("string");
      expect(await readFile(f.settingsPath, "utf8")).toBe(original);
    } finally {
      await f.cleanup();
    }
  });

  test("fails without clobbering a non-array projects key", async () => {
    const original = '{"projects":{"demo":{}}}\n';
    const f = await fixture(original);
    try {
      const response = await createProject(appFor(f), "demo");
      expect(response.status).toBe(500);
      const body = await response.json() as Record<string, unknown>;
      expect(body.ok).toBeUndefined();
      expect(await readFile(f.settingsPath, "utf8")).toBe(original);
    } finally {
      await f.cleanup();
    }
  });

  test("returns 500 with the command error when registration fails", async () => {
    const f = await fixture();
    const command: ProjectCommand = async (source) => source.includes("SETTINGS=")
      ? { exitCode: 1, stdout: "", stderr: "jq exploded" }
      : { exitCode: 0, stdout: "", stderr: "" };
    try {
      const response = await createProject(appFor(f, command), "demo");
      expect(response.status).toBe(500);
      const body = await response.json() as Record<string, unknown>;
      expect(body.ok).toBeUndefined();
      expect(String(body.error)).toContain("jq exploded");
    } finally {
      await f.cleanup();
    }
  });

  test("returns 500 when registration times out", async () => {
    const f = await fixture();
    const command: ProjectCommand = async (source) => source.includes("SETTINGS=")
      ? { exitCode: -1, stdout: "", stderr: "Command timed out after 10000ms" }
      : { exitCode: 0, stdout: "", stderr: "" };
    try {
      const response = await createProject(appFor(f, command), "demo");
      expect(response.status).toBe(500);
      const body = await response.json() as Record<string, unknown>;
      expect(body.ok).toBeUndefined();
      expect(String(body.error)).toContain("timed out");
    } finally {
      await f.cleanup();
    }
  });

  test("rejects unsafe project names before running any command", async () => {
    const f = await fixture();
    const invoked: string[] = [];
    const command: ProjectCommand = async (source) => {
      invoked.push(source);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      for (const name of ["../escape", "a/b", "na$me", 'quo"ted', "-leading-dash", ".hidden"]) {
        const response = await createProject(appFor(f, command), name);
        expect(response.status).toBe(400);
      }
      expect(invoked).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });
});
