import { execInAiDev, composeCommand, dockerCommand } from "./docker";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { readEnvFile, writeEnvFile } from "./env";

const BACKUP_DIR = "/opt/ai-engkit/backups";
const COMPOSE_FILE = "/opt/ai-engkit/compose.yml";
const ENV_FILE = "/opt/ai-engkit/.env";
const IMAGE = "ghcr.io/tryweb/ai-engkit:latest";

export type UpgradeStep =
  | "digest_compare"
  | "backup"
  | "merge_env"
  | "recreate"
  | "poll_health"
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
  const steps: UpgradeStep[] = ["digest_compare", "backup", "merge_env", "recreate", "poll_health", "cleanup"];
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

export async function runUpgrade(): Promise<boolean> {
  if (currentState === "running") {
    throw new Error("Upgrade already in progress");
  }

  // Pre-flight: ensure compose file is a regular file (not a DooD-empty directory)
  try {
    const st = statSync(COMPOSE_FILE);
    if (st.isDirectory()) {
      rmSync(COMPOSE_FILE, { recursive: true });
      const siblingName = await (await import("./docker")).getSiblingDevContainerName().catch(() => "ai-engkit-dev");
      writeFileSync(COMPOSE_FILE, `services:\n  ai-dev:\n    image: ${IMAGE}\n    container_name: ${siblingName}\n    restart: unless-stopped\n`);
    }
  } catch {
    const siblingName = await (await import("./docker")).getSiblingDevContainerName().catch(() => "ai-engkit-dev");
    writeFileSync(COMPOSE_FILE, `services:\n  ai-dev:\n    image: ${IMAGE}\n    container_name: ${siblingName}\n    restart: unless-stopped\n`);
  }

  // Dev build guard: version=dev indicates a locally-built image, skip upgrade
  let localVersion = "dev";
  try {
    localVersion = readFileSync("/opt/ai-engkit/VERSION", "utf-8").trim();
  } catch {}
  if (localVersion === "dev") {
    throw new Error("Dev build detected. Upgrade is only available for production releases (ghcr.io/tryweb/ai-engkit:latest).");
  }

  currentState = "running";
  eventLog = [];

  try {
    // Step 1: Digest compare
    emit("digest_compare", "running", "Fetching latest image digest...");
    const pullResult = await dockerCommand(`pull ${IMAGE}`, 180_000);
    if (pullResult.exitCode !== 0) {
      throw new Error(`Failed to pull image: ${pullResult.stderr}`);
    }
    emit("digest_compare", "success", "Latest image pulled successfully");

    // Step 2: Backup
    emit("backup", "running", "Creating pre-upgrade backup...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(BACKUP_DIR, `pre-${timestamp}`);
    mkdirSync(backupPath, { recursive: true });
    if (existsSync(ENV_FILE)) {
      cpSync(ENV_FILE, join(backupPath, ".env"));
    }
    if (existsSync(COMPOSE_FILE)) {
      try {
        const st = statSync(COMPOSE_FILE);
        if (!st.isDirectory()) cpSync(COMPOSE_FILE, join(backupPath, "compose.yml"));
      } catch {}
    }
    emit("backup", "success", `Backup saved to ${backupPath}`);

    // Step 3: Merge .env
    emit("merge_env", "running", "Merging new environment variables...");
    await mergeEnvFromUpstream();
    emit("merge_env", "success", "Environment variables merged");

    // Step 4: Recreate ai-dev
    emit("recreate", "running", "Recreating ai-dev container with new image...");
    const recreateResult = await composeCommand(
      `--env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d --force-recreate ai-dev`,
      300_000,
    );
    if (recreateResult.exitCode !== 0) {
      throw new Error(
        `Failed to recreate ai-dev: ${recreateResult.stderr || recreateResult.stdout || `exit code ${recreateResult.exitCode}`}`,
      );
    }
    emit("recreate", "success", "ai-dev container recreated");

    // Step 5: Poll health
    emit("poll_health", "running", "Waiting for ai-dev to become healthy...");
    const healthy = await pollAiDevHealth(120_000);
    if (!healthy) {
      throw new Error("ai-dev did not become healthy within timeout");
    }
    emit("poll_health", "success", "ai-dev is healthy");

    // Step 6: Cleanup
    emit("cleanup", "running", "Cleaning up old images and restarting admin dashboard...");
    await dockerCommand("image prune -f", 60_000);
    // Restart admin container so getUpdateCheck() compares the new image
    await dockerCommand(`compose -f ${COMPOSE_FILE} up -d --force-recreate ai-admin`, 120_000);
    emit("cleanup", "success", "Upgrade complete");

    currentState = "completed";
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Determine which step failed
    const failedStep = eventLog
      .filter((e) => e.status === "running")
      .pop()?.step;
    if (failedStep) {
      emit(failedStep, "failure", msg);
    }
    currentState = "failed";
    return false;
  }
}

async function mergeEnvFromUpstream(): Promise<void> {
  const currentEnv = readEnvFile();
  // Fetch .env.example from upstream
  const result = await execInAiDev(
    `curl -sS https://raw.githubusercontent.com/trywe-io/ai-engkit/main/.env.example 2>/dev/null || true`,
    30_000,
  );
  if (result.exitCode !== 0 || !result.stdout) return;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!(key in currentEnv)) {
      currentEnv[key] = "";
    }
  }
  writeEnvFile(currentEnv);
}

async function pollAiDevHealth(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await composeCommand("ps --filter status=running --format json", 10_000);
    if (result.exitCode === 0 && result.stdout.includes("ai-engkit")) {
      return true;
    }
    await sleep(3000);
  }
  return false;
}
