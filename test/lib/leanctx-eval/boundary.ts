import { createHash } from "node:crypto";

export class BoundaryParseError extends Error {
  readonly name = "BoundaryParseError";
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

export function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    if (error instanceof Error) throw new BoundaryParseError(path, `invalid JSON: ${error.message}`);
    throw new BoundaryParseError(path, "invalid JSON");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BoundaryParseError(path, `unknown property ${key}`);
  }
}

export function required(value: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in value)) throw new BoundaryParseError(path, `missing property ${key}`);
  return value[key];
}

export function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new BoundaryParseError(path, "expected string");
  return value;
}

export function integerValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new BoundaryParseError(path, "expected integer");
  return value;
}

export function nonNegativeInteger(value: unknown, path: string): number {
  const result = integerValue(value, path);
  if (result < 0) throw new BoundaryParseError(path, "expected non-negative integer");
  return result;
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new BoundaryParseError(path, "expected boolean");
  return value;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function hashCanonical(value: unknown): string {
  return sha256(canonicalJson(value));
}
