import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReconcileOutput, pruneOldBackups, resolveBackupRetention } from "./upgrade";

describe("resolveBackupRetention", () => {
  test("defaults to 5 when BACKUP_RETENTION is missing", () => {
    expect(resolveBackupRetention({})).toBe(5);
  });

  test("parses a valid positive integer", () => {
    expect(resolveBackupRetention({ BACKUP_RETENTION: "3" })).toBe(3);
    expect(resolveBackupRetention({ BACKUP_RETENTION: "10" })).toBe(10);
  });

  test("falls back to 5 for invalid values", () => {
    expect(resolveBackupRetention({ BACKUP_RETENTION: "0" })).toBe(5);
    expect(resolveBackupRetention({ BACKUP_RETENTION: "-1" })).toBe(5);
    expect(resolveBackupRetention({ BACKUP_RETENTION: "abc" })).toBe(5);
    expect(resolveBackupRetention({ BACKUP_RETENTION: "3.5" })).toBe(5);
  });
});

describe("pruneOldBackups", () => {
  function rootWith(dirs: string[]): { root: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "upgrade-prune-"));
    for (const d of dirs) {
      mkdirSync(join(root, d));
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test("removes oldest pre-* dirs beyond retention and returns their names", () => {
    const { root, cleanup } = rootWith(["pre-a", "pre-b", "pre-c", "pre-d"]);
    try {
      const removed = pruneOldBackups(root, 2);
      expect(removed).toEqual(["pre-a", "pre-b"]);
      expect(readdirSync(root).sort()).toEqual(["pre-c", "pre-d"]);
    } finally {
      cleanup();
    }
  });

  test("removes nothing when count is within retention", () => {
    const { root, cleanup } = rootWith(["pre-a", "pre-b"]);
    try {
      expect(pruneOldBackups(root, 5)).toEqual([]);
      expect(readdirSync(root).sort()).toEqual(["pre-a", "pre-b"]);
    } finally {
      cleanup();
    }
  });

  test("ignores retention below 1", () => {
    const { root, cleanup } = rootWith(["pre-a"]);
    try {
      expect(pruneOldBackups(root, 0)).toEqual([]);
      expect(readdirSync(root)).toEqual(["pre-a"]);
    } finally {
      cleanup();
    }
  });

  test("returns empty array for a missing backup root", () => {
    expect(pruneOldBackups(join(tmpdir(), "does-not-exist-xyz"), 2)).toEqual([]);
  });

  test("leaves non-pre-* entries untouched", () => {
    const { root, cleanup } = rootWith(["pre-a", "pre-b", "pre-c", "notes"]);
    try {
      pruneOldBackups(root, 2);
      expect(readdirSync(root).sort()).toEqual(["notes", "pre-b", "pre-c"]);
    } finally {
      cleanup();
    }
  });
});

describe("parseReconcileOutput", () => {
  test("parses a valid added count", () => {
    expect(parseReconcileOutput('{"added":2}')).toEqual({ added: 2 });
    expect(parseReconcileOutput('  {"added":0}  ')).toEqual({ added: 0 });
  });

  test("returns null for empty or non-JSON output", () => {
    expect(parseReconcileOutput("")).toBeNull();
    expect(parseReconcileOutput("   ")).toBeNull();
    expect(parseReconcileOutput("not json")).toBeNull();
  });

  test("returns null for wrong shapes", () => {
    expect(parseReconcileOutput("[1,2]")).toBeNull();
    expect(parseReconcileOutput("{}")).toBeNull();
    expect(parseReconcileOutput('{"added":"2"}')).toBeNull();
    expect(parseReconcileOutput('{"added":-1}')).toBeNull();
    expect(parseReconcileOutput('{"added":1.5}')).toBeNull();
  });
});
