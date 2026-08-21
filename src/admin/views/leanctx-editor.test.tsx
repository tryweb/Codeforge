import { describe, expect, it } from "bun:test";
import { LEANCTX_SCHEMA } from "../lib/leanctx-schema";
import { LeanCtxEditorPage } from "./leanctx-editor";

const meta = {
  source: "global" as const,
  globalPath: "/home/devuser/.config/lean-ctx/config.toml",
  projectPath: "/home/devuser/workspace/ai-engkit/.lean-ctx.toml",
  hasProjectOverride: false,
};

describe("LeanCtxEditorPage", () => {
  it("renders inline script JSON without HTML entity escaping", () => {
    const rendered = String(LeanCtxEditorPage(
      { "test.value": 'say "hi"' },
      meta,
      LEANCTX_SCHEMA,
    ));
    const script = [...rendered.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .find((content) => content.includes("function resetConfig")) ?? "";

    expect(script).not.toBe("");

    expect(script).not.toContain("&quot;");
    expect(script).toContain(JSON.stringify('say "hi"'));
    expect(script).toContain("function resetConfig");
    expect(script).toContain("function saveConfig");
  });
});
