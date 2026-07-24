import { Hono } from "hono";
import { execInAiDev } from "../lib/docker";
import { ProjectsPage } from "../views/projects";

const projects = new Hono();

const FEATURES = ["knowledge", "maintenance", "openspec"] as const;
type Feature = (typeof FEATURES)[number];

async function listProjects(): Promise<string[]> {
  const result = await execInAiDev("ls ~/workspace/ 2>/dev/null || echo ''", 10_000);
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean);
}

async function checkFeature(name: string, markerCmd: string): Promise<boolean> {
  const r = await execInAiDev(
    `test -e /home/devuser/workspace/${JSON.stringify(name)}/${markerCmd} && echo yes`,
    5_000,
  );
  return r.stdout.trim() === "yes";
}

projects.get("/api/projects", async (c) => {
  const list = await listProjects();
  return c.json(list);
});

projects.get("/api/projects/overview", async (c) => {
  const names = await listProjects();
  const results = await Promise.allSettled(names.map(async (name) => {
    const PROJ = (p: string) => `/home/devuser/workspace/${JSON.stringify(p)}`;
    const [feats, gitRemote] = await Promise.all([
      Promise.all([
        checkFeature(name, "docs/knowledge/README.md"),
        checkFeature(name, "docs/knowledge/maintenance/README.md"),
        checkFeature(name, "openspec"),
      ]).then(([knowledge, maintenance, openspec]) => ({ knowledge, maintenance, openspec })),
      execInAiDev(`cd ${PROJ(name)} && git remote get-url origin 2>/dev/null || true`, 10_000),
    ]);
    return {
      name,
      features: feats,
      remote: gitRemote.stdout.trim() || null,
    };
  }));
  const data: Record<string, any> = {};
  for (const r of results) {
    if (r.status === "fulfilled") data[r.value.name] = { features: r.value.features, remote: r.value.remote };
  }
  return c.json(data);
});

projects.get("/api/projects/:name/features", async (c) => {
  const name = c.req.param("name");
  if (!name || name.includes("..")) return c.json({ error: "Invalid project name" }, 400);

  // Verify project exists
  const exists = await execInAiDev(`test -d ~/workspace/${JSON.stringify(name)} && echo yes`, 5_000);
  if (exists.stdout.trim() !== "yes") return c.json({ error: "Project not found" }, 404);

  const [knowledge, maintenance, openspec] = await Promise.all([
    checkFeature(name, "docs/knowledge/README.md"),
    checkFeature(name, "docs/knowledge/maintenance/README.md"),
    checkFeature(name, "openspec"),
  ]);
  return c.json({ knowledge, maintenance, openspec });
});

projects.post("/api/projects", async (c) => {
  const body = await c.req.json();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Project name required" }, 400);

  const remote = body.git_remote?.trim();

  // If a remote URL is provided, clone instead of mkdir + init
  if (body.git_init && remote) {
    const cloneResult = await execInAiDev(
      `GIT_TERMINAL_PROMPT=0 git clone --depth 1 ${JSON.stringify(remote)} ~/workspace/${JSON.stringify(name)} 2>&1`,
      120_000,
    );
    if (cloneResult.exitCode !== 0 && cloneResult.exitCode !== -1) {
      const msg = cloneResult.stderr || cloneResult.stdout || "clone failed";
      return c.json({ error: `Clone failed. Make sure the URL is correct and git auth is configured (see GitHub/GitLab Auth page). Details: ${msg}` }, 500);
    }
  } else {
    // Local-only project: mkdir + optional git init
    const createResult = await execInAiDev(`mkdir -p ~/workspace/${JSON.stringify(name)}`, 15_000);
    if (createResult.exitCode !== 0) {
      return c.json({ error: createResult.stderr || "Failed to create directory" }, 500);
    }
    if (body.git_init) {
      const initResult = await execInAiDev(
        `cd ~/workspace/${JSON.stringify(name)} && git init 2>&1`, 10_000,
      );
      if (initResult.exitCode !== 0 && initResult.exitCode !== -1) {
        return c.json({ error: `git init failed: ${initResult.stderr || initResult.stdout}` }, 500);
      }
      // Try an initial commit; fine if it fails (empty directory)
      await execInAiDev(
        `cd ~/workspace/${JSON.stringify(name)} && git add -A && git commit -m "Initial commit" 2>/dev/null || true`,
        10_000,
      );
    }
  }

  // Register in OpenChamber so it appears automatically without manual "Add project"
  await execInAiDev(
    `SETTINGS=/home/devuser/.config/openchamber/settings.json && ` +
    `FULLPATH=/home/devuser/workspace/${JSON.stringify(name)} && ` +
    `ID=path_$(printf '%s' "$FULLPATH" | base64 -w0) && ` +
    `NOW=$(date +%s%3N) && ` +
    `jq --arg path "$FULLPATH" --arg id "$ID" --arg now "$NOW" ` +
    `'.projects += [{"id": $id, "path": $path, "addedAt": $now | tonumber, "lastOpenedAt": $now | tonumber}]' ` +
    `$SETTINGS > /tmp/settings.json && mv /tmp/settings.json $SETTINGS`,
    10_000,
  );

  return c.json({ ok: true });
});

projects.post("/api/projects/:name/features/:feature", async (c) => {
  const name = c.req.param("name");
  const feature = c.req.param("feature") as Feature;

  if (!FEATURES.includes(feature)) {
    return c.json({ error: `Unknown feature '${feature}'. Valid: ${FEATURES.join(", ")}` }, 400);
  }

  const PROJECT_ROOT = `/home/devuser/workspace/${JSON.stringify(name)}`;
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

  const result = await execInAiDev(cmd, 30_000);
  if (result.exitCode !== 0 && result.exitCode !== -1) {
    return c.json({ error: result.stderr || "Feature enable failed" }, 500);
  }
  return c.json({ ok: true, output: result.stdout });
});

projects.get("/api/projects/:name/git-remote", async (c) => {
  const name = c.req.param("name");
  const r = await execInAiDev(
    `cd ~/workspace/${JSON.stringify(name)} && git remote get-url origin 2>/dev/null || true`,
    10_000,
  );
  return c.json({ remote: r.stdout.trim() || null });
});

projects.put("/api/projects/:name/git-remote", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json();
  const url = body.remote?.trim();
  const base = `cd ~/workspace/${JSON.stringify(name)}`;

  if (!url) {
    await execInAiDev(`${base} && git remote remove origin 2>/dev/null || true`, 10_000);
    return c.json({ ok: true });
  }

  // Auto-init if not yet a git repo
  await execInAiDev(`${base} && git init 2>/dev/null || true`, 10_000);

  const hasRemote = await execInAiDev(
    `${base} && git remote get-url origin 2>/dev/null || echo "no-remote"`, 10_000,
  );
  const isNewRemote = hasRemote.stdout.trim() === "no-remote";
  const setCmd = isNewRemote
    ? `${base} && git remote add origin ${JSON.stringify(url)}`
    : `${base} && git remote set-url origin ${JSON.stringify(url)}`;

  const setResult = await execInAiDev(setCmd, 10_000);
  if (setResult.exitCode !== 0 && setResult.exitCode !== -1) {
    return c.json({ error: setResult.stderr || "Failed to set git remote" }, 500);
  }

  const hasCommits = await execInAiDev(
    `${base} && git cat-file -t HEAD 2>/dev/null || true`, 5_000,
  );
  if (hasCommits.stdout.trim() !== "commit") {
    const fetch = await execInAiDev(
      `GIT_TERMINAL_PROMPT=0 ${base} && git fetch origin --depth 1 2>&1`, 120_000,
    );
    if (fetch.exitCode !== 0 && fetch.exitCode !== -1) {
      return c.json({ error: `Remote set, but fetch failed: ${fetch.stderr || fetch.stdout || "unknown"}`, partial: true }, 500);
    }
    // Try checkout, force to handle untracked files from features (knowledge, openspec, etc.)
    const checkout = await execInAiDev(
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

const OPENCHAMBER_SETTINGS = "/home/devuser/.config/openchamber/settings.json";

async function getOpenChamberProjects(): Promise<string[]> {
  const r = await execInAiDev(
    `jq -r '.projects[] | select(.path | startswith("/home/devuser/workspace/")) | .path' ${OPENCHAMBER_SETTINGS} 2>/dev/null || true`,
    10_000,
  );
  return r.stdout.split("\n").filter(Boolean).map(p => p.replace("/home/devuser/workspace/", ""));
}

projects.get("/api/projects/sync", async (c) => {
  const [workspaceDirs, ocProjects] = await Promise.all([listProjects(), getOpenChamberProjects()]);
  const workspaceSet = new Set(workspaceDirs);
  const ocSet = new Set(ocProjects);

  const missingInOC = workspaceDirs.filter(d => !ocSet.has(d));
  const staleInOC = ocProjects.filter(d => !workspaceSet.has(d));

  return c.json({ missingInOC, staleInOC });
});

projects.post("/api/projects/sync", async (c) => {
  const body = await c.req.json();
  const add: string[] = body.add || [];
  const remove: string[] = body.remove || [];
  const msgs: string[] = [];

  for (const name of add) {
    const fullPath = `/home/devuser/workspace/${name}`;
    const id = `path_$(printf '%s' "$fullPath" | base64 -w0)`;
    const r = await execInAiDev(
      `jq --arg path "${fullPath}" --arg id "${id}" ` +
      `'.projects += [{"id": $id, "path": $path}]' ${OPENCHAMBER_SETTINGS} > /tmp/oc.json && mv /tmp/oc.json ${OPENCHAMBER_SETTINGS}`,
      10_000,
    );
    if (r.exitCode === 0 || r.exitCode === -1) msgs.push(`Added ${name} to OpenChamber`);
    else msgs.push(`Failed to add ${name}: ${r.stderr}`);
  }

  for (const name of remove) {
    const fullPath = `/home/devuser/workspace/${name}`;
    const r = await execInAiDev(
      `jq 'del(.projects[] | select(.path == "${fullPath}"))' ${OPENCHAMBER_SETTINGS} > /tmp/oc.json && mv /tmp/oc.json ${OPENCHAMBER_SETTINGS}`,
      10_000,
    );
    if (r.exitCode === 0 || r.exitCode === -1) msgs.push(`Removed ${name} from OpenChamber`);
    else msgs.push(`Failed to remove ${name}: ${r.stderr}`);
  }

  return c.json({ ok: true, messages: msgs });
});

projects.get("/projects", async (c) => {
  const list = await listProjects();
  return c.html(ProjectsPage(list));
});

export default projects;
