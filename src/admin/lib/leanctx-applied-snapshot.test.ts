import { describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import {
  canonicalizeAndFingerprint,
  deriveDashboardRuntimeState,
  readAppliedSnapshot,
  tryWriteAppliedSnapshotSafe,
  writeAppliedSnapshot,
} from "./leanctx-applied-snapshot";

const rnd = () => Math.random().toString(36).slice(2);

describe("canonicalizeAndFingerprint", () => {
  test("key order independence yields equal hashes", async () => {
    const a = { compression_level: "lite", tool_profile: "power", "archive.enabled": true } as Record<string, unknown>;
    const b = { tool_profile: "power", "archive.enabled": true, compression_level: "lite" } as Record<string, unknown>;
    const fa = canonicalizeAndFingerprint(a).fingerprint;
    const fb = canonicalizeAndFingerprint(b).fingerprint;
    expect(fa).toBe(fb);
    expect(fa).toMatch(/^[a-f0-9]{64}$/);
  });
  test("different values produce different hashes", () => {
    const fa = canonicalizeAndFingerprint({ compression_level: "lite" }).fingerprint;
    const fb = canonicalizeAndFingerprint({ compression_level: "max" }).fingerprint;
    expect(fa).not.toBe(fb);
  });
  test("recursively sorted keys produce stable JSON", () => {
    const { canonicalJson } = canonicalizeAndFingerprint({ archive: { max_disk_mb: 500, enabled: true }, compression_level: "lite" });
    expect(canonicalJson).toBe(JSON.stringify({ archive: { enabled: true, max_disk_mb: 500 }, compression_level: "lite" }));
  });
});

describe("write/read snapshot", () => {
  test("round-trip preserves whitelist and fingerprint", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    const config = {
      compression_level: "lite",
      tool_profile: "power",
      permission_inheritance: "on",
      "boundary_policy.cross_project_search": false,
      "secret_detection.enabled": true,
      "secret_detection.redact": true,
      "archive.enabled": true,
      "archive.max_age_hours": 48,
      "archive.max_disk_mb": 500,
    };
    await writeAppliedSnapshot(config, path);
    const snap = await readAppliedSnapshot(path);
    expect(snap).not.toBeNull();
    expect(snap?.version).toBe(1);
    expect(snap?.compressionLevel).toBe("lite");
    expect(snap?.permissionInheritance).toBe("on");
    expect(snap?.crossProjectSearch).toBe(false);
    expect(snap?.archiveMaxAgeHours).toBe(48);
    expect(snap?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await rm(dir, { recursive: true, force: true });
  });

  test("malformed JSON returns null", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await writeFile(path, "not json", { mode: 0o600 });
    expect(await readAppliedSnapshot(path)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("unsupported version fails closed to null", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify({ version: 2, fingerprint: "x".repeat(64) }), { mode: 0o600 });
    expect(await readAppliedSnapshot(path)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("file has 0600 permissions", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await writeAppliedSnapshot({ compression_level: "lite" }, path);
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
    await rm(dir, { recursive: true, force: true });
  });

  test("snapshot directory has 0700 permissions", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "nested", "shot.json");
    await writeAppliedSnapshot({ compression_level: "lite" }, path);
    const s = await stat(join(dir, "nested"));
    expect(s.mode & 0o777).toBe(0o700);
    await rm(dir, { recursive: true, force: true });
  });

  test("secret fields are not persisted", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await writeAppliedSnapshot({ compression_level: "lite", shell_allowlist_extra: ["gh"] } as Record<string, unknown>, path);
    const raw = await readFile(path, "utf-8");
    expect(raw).not.toContain("shell_allowlist_extra");
    expect(raw).not.toContain("gh");
    const snap = await readAppliedSnapshot(path);
    expect(snap).not.toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("atomic rename leaves no temp file", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await writeAppliedSnapshot({ compression_level: "max" }, path);
    const entries = await (await import("fs/promises")).readdir(dir);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  test("failed atomic rename removes its temp file", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await mkdir(path);
    expect(await tryWriteAppliedSnapshotSafe({ compression_level: "max" }, path)).toBe(false);
    const entries = await readdir(dir);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  test("exact whitelist — extra key rejects", async () => {
    const dir = join(tmpdir(), `snap-${rnd()}`);
    const path = join(dir, "shot.json");
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, fingerprint: "a".repeat(64), compressionLevel: "lite", extra: "bad" }), { mode: 0o600 });
    expect(await readAppliedSnapshot(path)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("deriveDashboardRuntimeState", () => {
  test("equal hashes applied", async () => {
    const config = { compression_level: "lite", tool_profile: "power" };
    const { fingerprint } = canonicalizeAndFingerprint(config);
    const snap = {
      version: 1 as const,
      fingerprint,
      compressionLevel: "lite" as const,
      toolProfile: "power" as const,
      permissionInheritance: "on" as const,
      crossProjectSearch: false,
      secretDetectionEnabled: true,
      secretRedactionEnabled: true,
      archiveEnabled: true,
      archiveMaxAgeHours: 48,
      archiveMaxDiskMb: 500,
    };
    const { profile } = deriveDashboardRuntimeState(config, snap);
    expect(profile.applyState).toBe("applied");
    expect(profile.compressionLevel).toBe("lite");
  });

  test("different hash pending retains applied values", () => {
    const saved = { compression_level: "max" };
    const snap = {
      version: 1 as const,
      fingerprint: "b".repeat(64),
      compressionLevel: "lite" as const,
      toolProfile: "power" as const,
      permissionInheritance: "on" as const,
      crossProjectSearch: false,
      secretDetectionEnabled: true,
      secretRedactionEnabled: true,
      archiveEnabled: true,
      archiveMaxAgeHours: 48,
      archiveMaxDiskMb: 500,
    };
    const { profile } = deriveDashboardRuntimeState(saved, snap);
    expect(profile.applyState).toBe("pending");
    expect(profile.compressionLevel).toBe("lite");
  });

  test("no snapshot saved-only", () => {
    const { profile } = deriveDashboardRuntimeState({ compression_level: "lite", tool_profile: "minimal" }, null);
    expect(profile.applyState).toBe("saved-only");
    expect(profile.compressionLevel).toBe("lite");
  });

  test("both unreadable runtime-unavailable", () => {
    const { profile } = deriveDashboardRuntimeState(null, null);
    expect(profile.applyState).toBe("runtime-unavailable");
  });

  test("permissionInheritance preserved on/off/null", () => {
    const { fingerprint } = canonicalizeAndFingerprint({ permission_inheritance: "on" });
    const snap = {
      version: 1 as const,
      fingerprint,
      compressionLevel: null,
      toolProfile: null,
      permissionInheritance: "on" as const,
      crossProjectSearch: null,
      secretDetectionEnabled: null,
      secretRedactionEnabled: null,
      archiveEnabled: null,
      archiveMaxAgeHours: null,
      archiveMaxDiskMb: null,
    };
    const { profile } = deriveDashboardRuntimeState({ permission_inheritance: "on" }, snap);
    expect(profile.permissionInheritance).toBe("on");
  });
});
