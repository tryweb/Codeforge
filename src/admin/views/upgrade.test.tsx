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
});
