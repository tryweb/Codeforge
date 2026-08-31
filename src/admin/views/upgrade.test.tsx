import { describe, expect, test } from "bun:test";
import { UpgradePage } from "./upgrade";

describe("UpgradePage view", () => {
  test("dev build shows not-available card and no selector", async () => {
    const html = UpgradePage({ devBuild: true }).toString();
    expect(html).toContain("Not Available in Dev Build");
    expect(html).not.toContain('id="version-selector-card"');
    expect(html).not.toContain('id="target-official"');
  });

  test("prod build shows selector radios, select, More, no-target warning, and start button disabled", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("version-selector-card");
    expect(html).toContain('id="target-official"');
    expect(html).toContain('id="target-specified"');
    expect(html).toContain('id="specified-select"');
    expect(html).toContain('id="more-versions"');
    expect(html).toContain('id="no-target-warning"');
    expect(html).toContain('id="start-upgrade"');
    expect(html).toContain("Start Upgrade");
    // progress card still present
    expect(html).toContain('id="progress-card"');
  });

  test("default (no devBuild) renders prod view", async () => {
    const html = UpgradePage({}).toString();
    expect(html).toContain("version-selector-card");
  });

  test("official radio has latest label handling in static HTML (placeholder)", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("official-label");
    expect(html).toContain("Official release");
  });

  test("contains script that fetches versions and posts version", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("/api/upgrade/versions");
    expect(html).toContain("/api/upgrade");
    expect(html).toContain("getSelectedVersion");
    expect(html).toContain("BATCH");
  });

  test("prod build shows current-version-display element", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain('id="current-version-display"');
    expect(html).toContain("Current Version");
  });

  test("dev build shows current-version-display", async () => {
    const html = UpgradePage({ devBuild: true }).toString();
    expect(html).toContain('id="current-version-display"');
  });

  test("prod build shows configured-version-warning element", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain('id="configured-version-warning"');
  });

  test("script reads configured_version from API response", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("configured_version");
    expect(html).toContain("configuredVersion");
  });

  test("script reads current_version and displays via textContent", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("current_version");
    expect(html).toContain("current-version-display");
    expect(html).toContain("textContent");
  });

  test("script posts target_type in upgrade request", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("target_type");
    expect(html).toContain("targetType");
  });

  test("script defaults to official when configuredVersion is null", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("!configuredVersion");
  });

  test("script shows configured-version-warning when configured version not in discovered list", async () => {
    const html = UpgradePage({ devBuild: false }).toString();
    expect(html).toContain("configured-version-warning");
    expect(html).toContain("is not in the discovered release list");
  });
});
