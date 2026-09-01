import { describe, expect, test } from "bun:test";
import {
  createHarness,
  createRestartAdminFromSource,
  getProductionRestartAdminSource,
} from "./dashboard-restart.test-support";

describe("dashboard restartAdmin behavioral — production extraction", () => {
  test("Given old admin remains healthy, When polling, Then does not reload and eventually times out", async () => {
    // Given: baseline uptime 100, digest abc, poll always returns same healthy values
    const harness = createHarness({
      baseline: { uptime: 100, digest: "sha256:abc" },
      postOk: true,
      pollSequence: Array.from({ length: 130 }, () => ({ ok: true, body: { uptime_seconds: 100, image_digest: "sha256:abc" } })),
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When: execute production restartAdmin
    await restartAdmin();

    // Then: no immediate reload
    expect(harness.isReloaded()).toBe(false);
    for (let i = 0; i < 130; i++) {
      await harness.runNextTimeout();
      if (harness.isReloaded()) break;
      if (harness.getAlerts().some((a) => a.includes("timed out"))) break;
    }
    expect(harness.getAlerts().some((a) => a.includes("timed out"))).toBe(true);
    expect(harness.getButton().disabled).toBe(false);
    expect(harness.getButton().textContent).toBe("↻ Restart");
    expect(harness.isReloaded()).toBe(false);
  });

  test("Given uptime resets, When polling, Then reloads", async () => {
    // Given: baseline uptime 100, poll returns same then lower uptime
    const harness = createHarness({
      baseline: { uptime: 100, digest: "sha256:abc" },
      postOk: true,
      pollSequence: [
        { ok: true, body: { uptime_seconds: 100, image_digest: "sha256:abc" } },
        { ok: true, body: { uptime_seconds: 2, image_digest: "sha256:abc" } },
      ],
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When
    await restartAdmin();
    await harness.runNextTimeout();
    expect(harness.isReloaded()).toBe(false);
    await harness.runNextTimeout();

    // Then
    expect(harness.isReloaded()).toBe(true);
  });

  test("Given digest changes, When polling, Then reloads", async () => {
    // Given
    const harness = createHarness({
      baseline: { uptime: 100, digest: "sha256:abc" },
      postOk: true,
      pollSequence: [
        { ok: true, body: { uptime_seconds: 100, image_digest: "sha256:abc" } },
        { ok: true, body: { uptime_seconds: 100, image_digest: "sha256:def" } },
      ],
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When
    await restartAdmin();
    await harness.runNextTimeout();
    expect(harness.isReloaded()).toBe(false);
    await harness.runNextTimeout();

    // Then
    expect(harness.isReloaded()).toBe(true);
  });

  test("Given observed unavailability then healthy, When polling, Then reloads via recovery", async () => {
    // Given: baseline, first poll non-ok, second poll healthy
    const harness = createHarness({
      baseline: { uptime: 100, digest: "sha256:abc" },
      postOk: true,
      pollSequence: [
        { ok: false, body: {} },
        { ok: true, body: { uptime_seconds: 100, image_digest: "sha256:abc" } },
      ],
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When
    await restartAdmin();
    await harness.runNextTimeout();
    expect(harness.isReloaded()).toBe(false);
    await harness.runNextTimeout();

    // Then
    expect(harness.isReloaded()).toBe(true);
  });

  test("Given poll throws then healthy, When polling, Then reloads", async () => {
    // Given: throw on first poll
    const harness = createHarness({
      baseline: { uptime: 80, digest: "sha256:xyz" },
      postOk: true,
      pollSequence: [
        { ok: true, throw: true },
        { ok: true, body: { uptime_seconds: 80, image_digest: "sha256:xyz" } },
      ],
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When
    await restartAdmin();
    await harness.runNextTimeout();
    expect(harness.isReloaded()).toBe(false);
    await harness.runNextTimeout();

    // Then
    expect(harness.isReloaded()).toBe(true);
  });

  test("Given POST 500 with server error, When restart attempted, Then alert propagates error and restores button", async () => {
    // Given: POST returns 500 with error JSON
    const harness = createHarness({
      baseline: { uptime: 50, digest: "sha256:abc" },
      postOk: false,
      postBody: { ok: false, error: "Failed to resolve host bind sources for ai-admin restart" },
      pollSequence: [],
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When
    await restartAdmin();

    // Then: alert contains server error, button restored, no reload, no polling
    expect(harness.getAlerts().length).toBe(1);
    expect(harness.getAlerts()[0].includes("Failed to resolve host bind sources")).toBe(true);
    expect(harness.getButton().disabled).toBe(false);
    expect(harness.getButton().textContent).toBe("↻ Restart");
    expect(harness.isReloaded()).toBe(false);
    expect(harness.getTimeouts().length).toBe(0);
  });

  test("Given POST 500 with unparsable JSON, When restart attempted, Then fallback alert and button restored", async () => {
    // Given: POST returns 500 but json() throws
    const harness = createHarness({
      baseline: { uptime: 50, digest: "sha256:abc" },
      postOk: false,
      pollSequence: [],
    });
    const source = getProductionRestartAdminSource();
    const restartAdmin = createRestartAdminFromSource(source, harness.deps);

    // When
    await restartAdmin();

    // Then: fallback message retained
    expect(harness.getAlerts().length).toBe(1);
    expect(harness.getAlerts()[0]).toBe("Failed to restart admin");
    expect(harness.getButton().disabled).toBe(false);
  });
});
