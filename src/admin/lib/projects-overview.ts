import { readDisabledProjects, type SettingsCommand } from "./openchamber-projects";
import type { CodegraphStatus, ProjectToolStatusProvider } from "./project-tool-status";

export type ProjectCommand = SettingsCommand;

export interface ProjectFeatures {
  knowledge: boolean;
  maintenance: boolean;
  openspec: boolean;
}

export interface ProjectOverview {
  name: string;
  features: ProjectFeatures;
  remote: string | null;
  disabled: boolean;
  /** Present only when the caller supplies a tool status provider. */
  codegraph?: CodegraphStatus | null;
}

const projectDir = (workspaceRoot: string, name: string) => JSON.stringify(`${workspaceRoot}/${name}`);

export async function listProjects(command: ProjectCommand, workspaceRoot: string): Promise<string[]> {
  const root = JSON.stringify(`${workspaceRoot}/`);
  const result = await command(`find ${root} -maxdepth 1 -type d ! -path ${root} ! -name '.*' -exec basename {} \\; 2>/dev/null || true`, 10_000);
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean);
}

export async function checkFeature(
  command: ProjectCommand,
  workspaceRoot: string,
  name: string,
  markerCmd: string,
): Promise<boolean> {
  const r = await command(
    `test -e ${projectDir(workspaceRoot, name)}/${markerCmd} && echo yes`,
    5_000,
  );
  return r.stdout.trim() === "yes";
}

export async function collectProjectOverviews(
  command: ProjectCommand,
  workspaceRoot: string,
  settingsPath: string,
  disabledPath: string,
  toolStatus?: ProjectToolStatusProvider,
): Promise<ProjectOverview[]> {
  // settingsPath is part of the pinned read-path signature shared with the
  // agent query handler; the overview itself only needs the disabled list.
  void settingsPath;
  const names = await listProjects(command, workspaceRoot);
  const disabled = new Set(await readDisabledProjects(command, disabledPath));
  const results = await Promise.allSettled(names.map(async (name) => {
    const [feats, gitRemote, tools] = await Promise.all([
      Promise.all([
        checkFeature(command, workspaceRoot, name, "docs/knowledge/README.md"),
        checkFeature(command, workspaceRoot, name, "docs/knowledge/maintenance/README.md"),
        checkFeature(command, workspaceRoot, name, "openspec"),
      ]).then(([knowledge, maintenance, openspec]) => ({ knowledge, maintenance, openspec })),
      command(`cd ${projectDir(workspaceRoot, name)} && git remote get-url origin 2>/dev/null || true`, 10_000),
      toolStatus !== undefined ? toolStatus.probe(name).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const overview: ProjectOverview = {
      name,
      features: feats,
      remote: gitRemote.stdout.trim() || null,
      disabled: disabled.has(name),
    };
    if (tools !== undefined) {
      overview.codegraph = tools.codegraph;
    }
    return overview;
  }));
  const overviews: ProjectOverview[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      overviews.push(r.value);
    }
  }
  return overviews;
}
