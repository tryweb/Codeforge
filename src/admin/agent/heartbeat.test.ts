import { describe, expect, test } from "bun:test";
import type { StatusResponse } from "../lib/status";
import {
  buildStatusReport,
  heartbeatIntervalMs,
  type HeartbeatDeps,
  type StatusReport,
} from "./heartbeat";

describe("heartbeat status report", () => {
  test("maps shared status and component versions into every report field", async () => {
    const status: StatusResponse = {
      container_status: "running",
      uptime_seconds: 3_600,
      containers: {
        "ai-dev": { status: "running", uptime_seconds: 3_600, version: "1.2.3" },
        "ai-admin": { status: "running", uptime_seconds: 8_450, version: "1.2.3" },
      },
      restart_count: 2,
      gh_auth: "authenticated",
      glab_auth: "not authenticated",
      git_user: "Agent User",
      project_count: 4,
      leanctx: null,
      gain: null,
      valueReport: null,
      proveReport: null,
      savingsReport: null,
      admin_version: "1.2.3",
      admin_version_mismatch: true,
    };
    const versions = {
      "AI-EngKit": "1.2.3",
      OpenCode: "1.0.0",
      OpenChamber: "2.0.0",
      Docker: "28.0.0",
    };
    const deps: HeartbeatDeps = {
      collectStatus: async () => status,
      getVersions: async () => versions,
      getUpdateCheck: async () => ({
        current: "1.2.3",
        latest: "latest",
        update_available: true,
        status: "update-available",
        configured: null,
        message: "New image available",
      }),
    };
    const expected: StatusReport = {
      container_status: "running",
      uptime_seconds: 3_600,
      containers: {
        "ai-dev": { status: "running", uptime_seconds: 3_600, version: "1.2.3" },
        "ai-admin": { status: "running", uptime_seconds: 8_450, version: "1.2.3" },
      },
      versions,
      gh_auth: "authenticated",
      glab_auth: "not authenticated",
      admin_version: "1.2.3",
      admin_version_mismatch: true,
      upgrade_state: "running",
      upgrade_available: true,
      latest_version: "latest",
    };

    const report = await buildStatusReport(deps, "running");

    expect(report).toEqual(expected);
  });

  test("uses a 60-second heartbeat interval", () => {
    expect(heartbeatIntervalMs()).toBe(60_000);
  });
});
