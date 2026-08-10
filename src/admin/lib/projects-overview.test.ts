import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkFeature,
  collectProjectOverviews,
  listProjects,
  type ProjectCommand,
} from "./projects-overview";

async function shellCommand(source: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["sh", "-c", source], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/**
 * Runs the real find/test/jq shell against the tmp fixture; fakes the git
 * remote lookup (alpha has one, everything else does not).
 */
function createCommand(workspaceRoot: string): ProjectCommand {
  return async (source) => {
    if (source.includes("DISABLED=")) return shellCommand(source);
    if (source.startsWith("find ")) return shellCommand(source);
    if (source.includes("test -e")) return shellCommand(source);
    if (source.includes("git remote get-url")) {
      return source.includes(`${workspaceRoot}/alpha`)
        ? { exitCode: 0, stdout: "https://example.com/alpha.git", stderr: "" }
        : { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

interface Fixture {
  settingsPath: string;
  disabledPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "projects-overview-"));
  const settingsPath = join(directory, "settings.json");
  const disabledPath = join(directory, "disabled-projects.json");
  const workspaceRoot = join(directory, "workspace");

  // alpha: knowledge + openspec enabled, no maintenance, has a git remote.
  await mkdir(join(workspaceRoot, "alpha", "docs", "knowledge"), { recursive: true });
  await writeFile(join(workspaceRoot, "alpha", "docs", "knowledge", "README.md"), "# knowledge\n");
  await mkdir(join(workspaceRoot, "alpha", "openspec"), { recursive: true });
  // beta: no features, disabled.
  await mkdir(join(workspaceRoot, "beta"), { recursive: true });
  await writeFile(disabledPath, JSON.stringify({ disabled: ["beta"] }) + "\n");

  return {
    settingsPath,
    disabledPath,
    workspaceRoot,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

describe("listProjects", () => {
  test("lists workspace directories by basename", async () => {
    const f = await fixture();
    try {
      const names = await listProjects(createCommand(f.workspaceRoot), f.workspaceRoot);
      expect([...names].sort()).toEqual(["alpha", "beta"]);
    } finally {
      await f.cleanup();
    }
  });
});

describe("checkFeature", () => {
  test("detects marker presence per project", async () => {
    const f = await fixture();
    try {
      const command = createCommand(f.workspaceRoot);
      expect(await checkFeature(command, f.workspaceRoot, "alpha", "docs/knowledge/README.md")).toBe(true);
      expect(await checkFeature(command, f.workspaceRoot, "alpha", "docs/knowledge/maintenance/README.md")).toBe(false);
      expect(await checkFeature(command, f.workspaceRoot, "beta", "openspec")).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
});

describe("collectProjectOverviews", () => {
  test("returns features, remote, and disabled state per project", async () => {
    const f = await fixture();
    try {
      const overviews = await collectProjectOverviews(
        createCommand(f.workspaceRoot),
        f.workspaceRoot,
        f.settingsPath,
        f.disabledPath,
      );
      const byName = new Map(overviews.map((o) => [o.name, o]));

      expect(byName.get("alpha")).toEqual({
        name: "alpha",
        features: { knowledge: true, maintenance: false, openspec: true },
        remote: "https://example.com/alpha.git",
        disabled: false,
      });
      expect(byName.get("beta")).toEqual({
        name: "beta",
        features: { knowledge: false, maintenance: false, openspec: false },
        remote: null,
        disabled: true,
      });
    } finally {
      await f.cleanup();
    }
  });
});
