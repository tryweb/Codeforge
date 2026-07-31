import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV_PATH = "/opt/ai-engkit/.env";

export interface EnvVars {
  [key: string]: string;
}

export function readEnvFile(): EnvVars {
  const vars: EnvVars = {};
  if (!existsSync(ENV_PATH)) return vars;
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function writeEnvFile(vars: EnvVars): void {
  const lines: string[] = [];
  // Preserve existing comments by reading original
  if (existsSync(ENV_PATH)) {
    const original = readFileSync(ENV_PATH, "utf-8");
    for (const line of original.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        lines.push(line);
      }
    }
  }
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

export function upsertEnvVar(key: string, value: string): void {
  const vars = readEnvFile();
  vars[key] = value;
  writeEnvFile(vars);
}

export function deleteEnvVar(key: string): void {
  const vars = readEnvFile();
  if (!(key in vars)) return;
  delete vars[key];
  writeEnvFile(vars);
}

export function readEnvAsString(): string {
  if (!existsSync(ENV_PATH)) return "";
  return readFileSync(ENV_PATH, "utf-8");
}

export function envFileExists(): boolean {
  return existsSync(ENV_PATH);
}
