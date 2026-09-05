import {
  execInAiDev,
  composeCommand,
  dockerCommand,
  getAiDevContainerRef,
  getComposeProject,
  getSiblingDevContainerName,
  isAiDevRunning,
  type ExecResult,
} from "./docker";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readEnvFile, writeEnvFile, type EnvVars } from "./env";
import { KEYS_PATH } from "./provider-keys";
import { resolveImageRef } from "./image-ref";

const BACKUP_DIR = "/opt/ai-engkit/backups";
const COMPOSE_FILE = "/opt/ai-engkit/compose.yml";
const ENV_FILE = "/opt/ai-engkit/.env";
const UPSTREAM_REPO = "https://raw.githubusercontent.com/tryweb/ai-engkit";

/**
 * Upstream raw-content base for upgrade assets (compose file,
 * .env.example). Pinned installs (AI_ENGKIT_VERSION in .env) fetch assets
 * matching their running version instead of whatever main currently has.
 */
function upstreamBase(): string {
  const version = readEnvFile().AI_ENGKIT_VERSION?.trim();
  return version ? `${UPSTREAM_REPO}/${version}` : `${UPSTREAM_REPO}/main`;
}

/** BACKUP_RETENTION from .env: positive integer, default 5 (mirrors upgrade.sh). */
export function resolveBackupRetention(env: EnvVars): number {
  const raw = env.BACKUP_RETENTION;
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return 5;
  const n = Number(raw);
  return n >= 1 ? n : 5;
}

/** Delete oldest pre-* backup dirs beyond retention; returns the removed names. */
export function pruneOldBackups(backupRoot: string, retention: number): string[] {
  if (retention < 1) return [];
  let dirs: string[];
  try {
    dirs = readdirSync(backupRoot).filter((d: string) => d.startsWith("pre-")).sort();
  } catch {
    return [];
  }
  const toRemove = dirs.length - retention;
  if (toRemove <= 0) return [];
  const removed: string[] = [];
  for (const d of dirs.slice(0, toRemove)) {
    rmSync(join(backupRoot, d), { recursive: true, force: true });
    removed.push(d);
  }
  return removed;
}

/** Parse the reconcile script's {"added":N} output; null when not parseable. */
export function parseReconcileOutput(stdout: string): { added: number } | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const added = (parsed as Record<string, unknown>).added;
    if (typeof added !== "number" || !Number.isInteger(added) || added < 0) return null;
    return { added };
  } catch {
    return null;
  }
}

export type UpgradeStep =
  | "digest_compare"
  | "backup"
  | "merge_env"
  | "recreate"
  | "poll_health"
  | "reconcile"
  | "cleanup";

export type StepStatus = "pending" | "running" | "success" | "failure";

export interface UpgradeEvent {
  id: number;
  step: UpgradeStep;
  status: StepStatus;
  message: string;
  timestamp: string;
}

let nextEventId = 1;

export type UpgradeState = "idle" | "running" | "completed" | "failed";

let currentState: UpgradeState = "idle";
let eventLog: UpgradeEvent[] = [];
let logSubscribers: ((event: UpgradeEvent) => void)[] = [];

export function getState(): UpgradeState {
  return currentState;
}

export function getEventLog(): UpgradeEvent[] {
  return [...eventLog];
}

export function subscribe(subscriber: (event: UpgradeEvent) => void): () => void {
  logSubscribers.push(subscriber);
  return () => {
    logSubscribers = logSubscribers.filter((s) => s !== subscriber);
  };
}

function emit(step: UpgradeStep, status: StepStatus, message: string): void {
  const event: UpgradeEvent = {
    id: nextEventId++,
    step,
    status,
    message,
    timestamp: new Date().toISOString(),
  };
  eventLog.push(event);
  for (const sub of logSubscribers) {
    sub(event);
  }
}

export function getStatus(): { state: UpgradeState; events: UpgradeEvent[]; current_step: UpgradeStep | ""; progress_pct: number } {
  const steps: UpgradeStep[] = ["digest_compare", "backup", "merge_env", "recreate", "poll_health", "reconcile", "cleanup"];
  const lastRunning = [...eventLog].reverse().find((e) => e.status === "running");
  const lastFailed = [...eventLog].reverse().find((e) => e.status === "failure");
  const currentStep = lastFailed?.step || lastRunning?.step || "";
  const doneSteps = eventLog.filter((e) => e.status === "success").length;
  const totalSteps = steps.length;
  return {
    state: currentState,
    events: [...eventLog],
    current_step: currentStep,
    progress_pct: Math.round((doneSteps / totalSteps) * 100),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchLatestCompose(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${upstreamBase()}/docker-compose.yml`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic seams for the upgrade pipeline. Every field is optional and
 * defaults to the real production implementation, so `runUpgrade()` with no
 * arguments behaves exactly as before. Tests inject fakes here instead of
 * touching Docker, the network, or host paths.
 */
export interface MergeEnvDeps {
  readEnv?: () => EnvVars;
  writeEnv?: (vars: EnvVars) => void;
  fetchEnvExample?: () => Promise<string | null>;
}

export interface PollHealthDeps {
  isRunning?: () => Promise<boolean>;
  sleepMs?: (ms: number) => Promise<void>;
  intervalMs?: number;
}

export interface UpgradeDeps extends MergeEnvDeps, PollHealthDeps {
  backupDir?: string;
  composeFile?: string;
  envFile?: string;
  keysFile?: string;
  versionFile?: string;
  resolveImage?: () => string;
  readLocalVersion?: () => string | null;
  ensureComposeFile?: () => Promise<void>;
  pullImage?: (imageRef: string) => Promise<ExecResult>;
  getContainerRef?: () => Promise<string>;
  snapshotSettings?: (containerRef: string, destPath: string) => Promise<ExecResult>;
  fetchComposeText?: () => Promise<string | null>;
  writeComposeText?: (content: string) => void;
  getProject?: () => Promise<string>;
  composeUp?: (project: string) => Promise<ExecResult>;
  reconcile?: () => Promise<ExecResult>;
  pruneOld?: (backupRoot: string, retention: number) => string[];
  pruneImages?: () => Promise<ExecResult>;
  healthTimeoutMs?: number;
}

async function defaultFetchEnvExample(): Promise<string | null> {
  const result = await execInAiDev(`curl -sS ${upstreamBase()}/.env.example 2>/dev/null || true`, 30_000);
  if (result.exitCode !== 0 || !result.stdout) return null;
  return result.stdout;
}

async function defaultEnsureComposeFile(composeFile: string, resolveImage: () => string): Promise<void> {
  try {
    const st = statSync(composeFile);
    if (!st.isDirectory()) return;
    rmSync(composeFile, { recursive: true });
  } catch (err: unknown) {
    if (existsSync(composeFile)) {
      void err;
      return;
    }
    void err;
  }
  let siblingName = "ai-engkit-dev";
  try {
    siblingName = await getSiblingDevContainerName();
  } catch (err: unknown) {
    void err;
  }
  writeFileSync(
    composeFile,
    `services:\n  ai-dev:\n    image: ${resolveImage()}\n    container_name: ${siblingName}\n    restart: unless-stopped\n`,
  );
}

function defaultReadLocalVersion(versionFile: string): string | null {
  try {
    return readFileSync(versionFile, "utf-8").trim();
  } catch (err: unknown) {
    void err;
    return null;
  }
}

export async function runUpgrade(deps: UpgradeDeps = {}): Promise<boolean> {
  if (currentState === "running") {
    throw new Error("Upgrade already in progress");
  }

  const backupDir = deps.backupDir ?? BACKUP_DIR;
  const composeFile = deps.composeFile ?? COMPOSE_FILE;
  const envFile = deps.envFile ?? ENV_FILE;
  const keysFile = deps.keysFile ?? KEYS_PATH;
  const versionFile = deps.versionFile ?? "/opt/ai-engkit/VERSION";
  const resolveImage = deps.resolveImage ?? resolveImageRef;
  const readLocalVersion = deps.readLocalVersion ?? (() => defaultReadLocalVersion(versionFile));
  const ensureComposeFile = deps.ensureComposeFile ?? (() => defaultEnsureComposeFile(composeFile, resolveImage));
  const pullImage = deps.pullImage ?? ((ref: string) => dockerCommand(`pull ${ref}`, 180_000));
  const getContainerRef = deps.getContainerRef ?? getAiDevContainerRef;
  const snapshotSettings =
    deps.snapshotSettings ??
    ((ref: string, dest: string) =>
      dockerCommand(`cp ${ref}:/home/devuser/.config/openchamber/settings.json ${dest}`, 30_000));
  const fetchComposeText = deps.fetchComposeText ?? fetchLatestCompose;
  const writeComposeText = deps.writeComposeText ?? ((content: string) => writeFileSync(composeFile, content));
  const getProject = deps.getProject ?? getComposeProject;
  const composeUp =
    deps.composeUp ??
    ((project: string) =>
      composeCommand(`-p ${project} --env-file ${envFile} -f ${composeFile} up -d --force-recreate ai-dev`, 300_000));
  const reconcile =
    deps.reconcile ?? (() => execInAiDev("/opt/ai-engkit/scripts/reconcile-openchamber-projects.sh", 60_000));
  const pruneOld = deps.pruneOld ?? pruneOldBackups;
  const pruneImages = deps.pruneImages ?? (() => dockerCommand("image prune -f", 60_000));
  const healthTimeoutMs = deps.healthTimeoutMs ?? 120_000;

  // Pre-flight: ensure compose file is a regular file (not a DooD-empty directory)
  await ensureComposeFile();

  // Dev build guard: version=dev indicates a locally-built image, skip upgrade
  const localVersion = readLocalVersion();
  if (localVersion === "dev") {
    throw new Error("Dev build detected. Upgrade is only available for production releases (ghcr.io/tryweb/ai-engkit:latest).");
  }

  currentState = "running";
  eventLog = [];

  // Rollback tracking: only recreate/poll_health failures roll back, using the
  // backup created by this run. Digest/backup/merge failures never roll back.
  let backupPath: string | null = null;

  try {
    // Step 1: Digest compare
    emit("digest_compare", "running", "Fetching latest image digest...");
    const pullResult = await pullImage(resolveImage());
    if (pullResult.exitCode !== 0) {
      throw new Error(`Failed to pull image: ${pullResult.stderr}`);
    }
    emit("digest_compare", "success", "Latest image pulled successfully");

    // Step 2: Backup
    emit("backup", "running", "Creating pre-upgrade backup...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = join(backupDir, `pre-${timestamp}`);
    mkdirSync(backupPath, { recursive: true });
    if (existsSync(envFile)) {
      cpSync(envFile, join(backupPath, ".env"));
    }
    if (existsSync(composeFile)) {
      try {
        const st = statSync(composeFile);
        if (!st.isDirectory()) cpSync(composeFile, join(backupPath, "compose.yml"));
      } catch (err: unknown) {
        void err;
      }
    }
    if (existsSync(keysFile)) {
      cpSync(keysFile, join(backupPath, "provider-keys.json"));
    }
    const backupNotes: string[] = [];
    // Snapshot the registration list while the old image still runs; the new
    // image may start with a fresh list that needs reconciling against it.
    const devRef = await getContainerRef();
    const snapshot = await snapshotSettings(devRef, join(backupPath, "openchamber-settings.json"));
    backupNotes.push(
      snapshot.exitCode === 0 ? "OpenChamber settings snapshot saved" : "OpenChamber settings not found, snapshot skipped",
    );
    emit(
      "backup",
      "success",
      `Backup saved to ${backupPath}${backupNotes.length > 0 ? ` (${backupNotes.join("; ")})` : ""}`,
    );

    // Step 3: Merge .env
    emit("merge_env", "running", "Merging new environment variables...");
    await mergeEnvFromUpstream(deps);
    emit("merge_env", "success", "Environment variables merged");

    // Step 4: Recreate ai-dev
    emit("recreate", "running", "Fetching latest docker-compose.yml, then recreating ai-dev with new image...");
    // Apply the latest compose file from upstream so services added since the
    // last deploy take effect. Fail closed when unreachable: throwing before
    // writeComposeText/composeUp leaves the live compose file untouched, and
    // rollback below restores the backed-up file, so forward progress must
    // never run on stale compose content. Cleanup/pruning only runs on success.
    const latestCompose = await fetchComposeText();
    if (latestCompose === null) throw new Error("Failed to fetch latest docker-compose.yml");
    writeComposeText(latestCompose);
    const project = await getProject();
    const recreateResult = await composeUp(project);
    if (recreateResult.exitCode !== 0) {
      throw new Error(
        `Failed to recreate ai-dev: ${recreateResult.stderr || recreateResult.stdout || `exit code ${recreateResult.exitCode}`}`,
      );
    }
    emit("recreate", "success", "ai-dev container recreated");

    // Step 5: Poll health
    emit("poll_health", "running", "Waiting for ai-dev to become healthy...");
    const healthy = await pollAiDevHealth(healthTimeoutMs, deps);
    if (!healthy) {
      throw new Error("ai-dev did not become healthy within timeout");
    }
    emit("poll_health", "success", "ai-dev is healthy");

    // Step 6: Reconcile OpenChamber registrations. Soft step on purpose:
    // a reconcile failure must not fail the upgrade; the manual
    // Projects → Sync flow stays available as the fallback.
    emit("reconcile", "running", "Reconciling OpenChamber project registrations...");
    const reconcileResult = await reconcile();
    if (reconcileResult.exitCode === 0) {
      const parsed = parseReconcileOutput(reconcileResult.stdout);
      if (parsed !== null && parsed.added > 0) {
        emit("reconcile", "success", `${parsed.added} project registration${parsed.added === 1 ? "" : "s"} restored`);
      } else if (parsed !== null) {
        emit("reconcile", "success", "Registration list is consistent; nothing needed restoring");
      } else {
        emit("reconcile", "success", `Reconcile finished: ${reconcileResult.stdout.trim() || "no output"}`);
      }
    } else {
      const detail = reconcileResult.stderr.trim() || reconcileResult.stdout.trim() || `exit code ${reconcileResult.exitCode}`;
      emit("reconcile", "success", `Reconcile skipped: ${detail} (manual sync remains available)`);
    }

    // Step 7: Cleanup. Old backups are pruned only on the success path so a
    // failed upgrade never deletes history it might need for recovery.
    emit("cleanup", "running", "Cleaning up old images...");
    await pruneImages();
    const pruned = pruneOld(backupDir, resolveBackupRetention((deps.readEnv ?? readEnvFile)()));
    emit("cleanup", "success", pruned.length > 0 ? `Upgrade complete (${pruned.length} old backup(s) pruned)` : "Upgrade complete");

    currentState = "completed";
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Determine which step failed
    const failedStep = eventLog
      .filter((e) => e.status === "running")
      .pop()?.step;
    if (failedStep) {
      let failureMessage = msg;
      if (backupPath !== null && (failedStep === "recreate" || failedStep === "poll_health")) {
        const rollbackSummary = await rollbackToBackup(backupPath, { envFile, composeFile, getProject, composeUp });
        failureMessage = `${msg} (rollback: ${rollbackSummary})`;
      }
      emit(failedStep, "failure", failureMessage);
    }
    currentState = "failed";
    return false;
  }
}

/**
 * Restore .env and compose.yml byte-for-byte from this run's backup, then
 * re-run compose up so the previous container is live again. Returns a short
 * human-readable summary; never throws, so the original failure stays visible.
 */
async function rollbackToBackup(
  backupPath: string,
  ops: {
    envFile: string;
    composeFile: string;
    getProject: () => Promise<string>;
    composeUp: (project: string) => Promise<ExecResult>;
  },
): Promise<string> {
  const restored: string[] = [];
  const errors: string[] = [];
  for (const [backupName, target] of [[".env", ops.envFile], ["compose.yml", ops.composeFile]] as const) {
    const source = join(backupPath, backupName);
    try {
      if (!existsSync(source)) continue;
      const bytes = readFileSync(source);
      writeFileSync(target, bytes);
      restored.push(backupName);
    } catch (err: unknown) {
      errors.push(`${backupName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    const project = await ops.getProject();
    const recompose = await ops.composeUp(project);
    if (recompose.exitCode !== 0) {
      errors.push(
        `compose up: ${recompose.stderr || recompose.stdout || `exit code ${recompose.exitCode}`}`,
      );
    }
  } catch (err: unknown) {
    errors.push(`compose up: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (errors.length > 0) {
    return `partial (restored: ${restored.length > 0 ? restored.join(", ") : "none"}; errors: ${errors.join("; ")})`;
  }
  return `restored ${restored.length > 0 ? restored.join(", ") : "nothing to restore"} and re-ran compose up`;
}

export async function mergeEnvFromUpstream(deps: MergeEnvDeps = {}): Promise<void> {
  const readEnv = deps.readEnv ?? readEnvFile;
  const writeEnv = deps.writeEnv ?? writeEnvFile;
  const fetchExample = deps.fetchEnvExample ?? defaultFetchEnvExample;
  const currentEnv = readEnv();
  // Fetch .env.example from upstream
  const example = await fetchExample();
  if (!example) return;
  for (const line of example.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || key in currentEnv) continue;
    // Preserve the upstream default (substring after the first '=').
    currentEnv[key] = trimmed.slice(eqIdx + 1).trim();
  }
  writeEnv(currentEnv);
}

export async function pollAiDevHealth(timeoutMs: number, deps: PollHealthDeps = {}): Promise<boolean> {
  const isRunning = deps.isRunning ?? isAiDevRunning;
  const sleepFn = deps.sleepMs ?? sleep;
  const intervalMs = deps.intervalMs ?? 3000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isRunning()) {
      return true;
    }
    await sleepFn(intervalMs);
  }
  return false;
}
