import { describe, expect, it } from "bun:test";
import { LEANCTX_SCHEMA } from "../lib/leanctx-schema";
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

describe("LeanCtxEditorPage", () => {
  it("preserves configuration values in the page tree without HTML entity escaping", () => {
    const rendered = renderTree();

    expect(rendered).toContain('say \\"hi\\"');
    expect(rendered).not.toContain("&quot;");
  });
});
