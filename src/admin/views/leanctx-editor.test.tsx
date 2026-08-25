import { describe, expect, it } from "bun:test";
import { LEANCTX_SCHEMA } from "../lib/leanctx-schema";
import type { DoneClaim } from "../lib/leanctx-drift";
import { LeanCtxEditorPage } from "./leanctx-editor";

const meta = {
  source: "global" as const,
  globalPath: "/tmp/global/config.toml",
  projectPath: "/tmp/project/config.toml",
  hasProjectOverride: false,
  baselinePath: "/etc/lean-ctx/config.default.toml",
};

function renderTree(): string {
  return JSON.stringify(LeanCtxEditorPage({ "test.value": 'say "hi"' }, meta, LEANCTX_SCHEMA));
}

function renderWithDrift(drift: DoneClaim): string {
  return String(LeanCtxEditorPage({ "test.value": "value" }, meta, LEANCTX_SCHEMA, drift));
}

describe("LeanCtxEditorPage", () => {
  it("preserves configuration values in the page tree without HTML entity escaping", () => {
    const rendered = renderTree();

    expect(rendered).toContain('say \\"hi\\"');
    expect(rendered).not.toContain("&quot;");
  });

  it("does not render a drift warning for a healthy claim", () => {
    const rendered = renderWithDrift({
      done: true,
      status: "healthy",
      details: [],
      checkedAt: "2026-08-25T00:00:00.000Z",
    });

    expect(rendered).not.toContain('role="alert"');
  });

const warningCases = [
    ["config_drift", "Configuration drift detected."],
    ["project_override", "Project override detected."],
    ["daemon_unavailable", "LeanCTX daemon unavailable."],
    ["behavioral_mismatch", "LeanCTX behavior mismatch detected."],
    ["indeterminate", "LeanCTX drift status is indeterminate."],
  ] as const;

function claimFor(status: (typeof warningCases)[number][0]): DoneClaim {
  switch (status) {
    case "behavioral_mismatch":
      return {
        done: true,
        status,
        details: [`${status} detail`],
        expectedBytes: 1,
        observedBytes: 2,
        expectedSha256: "expected",
        observedSha256: "observed",
        checkedAt: "2026-08-25T00:00:00.000Z",
      };
    case "config_drift":
    case "project_override":
    case "daemon_unavailable":
    case "indeterminate":
      return {
        done: true,
        status,
        details: [`${status} detail`],
        checkedAt: "2026-08-25T00:00:00.000Z",
      };
    default:
      throw new Error(`Unexpected warning status: ${String(status)}`);
  }
}

  for (const [status, title] of warningCases) {
    it(`renders a persistent accessible warning for ${status}`, () => {
      const rendered = renderWithDrift(claimFor(status));

      expect(rendered).toContain('class="config-error leanctx-drift-warning"');
      expect(rendered).toContain(`data-drift-status="${status}"`);
      expect(rendered).toContain('role="alert"');
      expect(rendered).toContain(title);
      expect(rendered).toContain(`${status} detail`);
      expect(rendered).toContain("Detection does not apply or restart configuration.");
      expect(rendered).toContain("2026-08-25T00:00:00.000Z");
    });
  }
});
