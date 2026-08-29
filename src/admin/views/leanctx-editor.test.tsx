import { describe, expect, it } from "bun:test";
import { LEANCTX_SCHEMA } from "../lib/leanctx-schema";
import { LeanCtxEditorPage } from "./leanctx-editor";

const meta = {
  globalPath: "/home/devuser/.config/lean-ctx/config.toml",
  baselinePath: "/etc/lean-ctx/config.default.toml",
};

function renderProps(): string {
  return JSON.stringify(LeanCtxEditorPage({ "test.value": 'say "hi"' }, meta, LEANCTX_SCHEMA));
}

function renderHtml(): string {
  return String(LeanCtxEditorPage({ "test.value": "value" }, meta, LEANCTX_SCHEMA));
}

describe("LeanCtxEditorPage", () => {
  it("preserves configuration values in the page tree without HTML entity escaping", () => {
    const rendered = renderProps();

    expect(rendered).toContain('say \\"hi\\"');
    expect(rendered).not.toContain("&quot;");
  });

  it("renders the structured editor with Save, Validate, Apply, and Reset controls", () => {
    const rendered = renderHtml();

    expect(rendered).toContain('data-key="compression_level"');
    expect(rendered).toContain("Save Changes");
    expect(rendered).toContain("Validate Config");
    expect(rendered).toContain("Apply Saved Config");
    expect(rendered).toContain("Reset to Defaults");
    expect(rendered).toContain("Default:");
  });

  it("does not render drift, status, or doctor UI", () => {
    const rendered = renderHtml();

    expect(rendered).not.toContain("leanctx-drift-warning");
    expect(rendered).not.toContain("/api/leanctx/drift");
    expect(rendered).not.toContain("/api/leanctx/status");
    expect(rendered).not.toContain("Run LeanCTX Doctor");
    expect(rendered).not.toContain("restarts the LeanCTX daemon in ai-dev");
  });

  it("describes Apply as lean-ctx config apply without container recreation", () => {
    const rendered = renderHtml();

    expect(rendered).toContain("lean-ctx config apply");
    expect(rendered).toContain('id="apply-config-help"');
    expect(rendered).toContain('aria-live="polite"');
    expect(rendered).not.toContain("restarting the LeanCTX daemon");
  });

  it("renders the repair banner when the runtime config is malformed", () => {
    const rendered = String(
      LeanCtxEditorPage(
        {},
        { ...meta, runtimeParseError: "/home/devuser/.config/lean-ctx/config.toml is malformed TOML: broken" },
        LEANCTX_SCHEMA,
      ),
    );

    expect(rendered).toContain("Configuration requires repair.");
    expect(rendered).toContain("is malformed TOML");
    expect(rendered).toContain('role="alert"');
  });

  it("renders no repair banner when both config layers parse", () => {
    const rendered = renderHtml();

    expect(rendered).not.toContain("Configuration requires repair.");
  });

  it("includes mobile layout rules for the configuration form", () => {
    const rendered = renderHtml();

    expect(rendered).toContain(".config-table thead { display: none; }");
    expect(rendered).toContain(".config-table tr[data-key] { display: block;");
    expect(rendered).toContain(".editor-actions { display: grid;");
    expect(rendered).toContain("min-height: 44px");
    expect(rendered).toContain("font-size: 16px");
  });
});
