import { describe, expect, test } from "bun:test";
import { evaluate } from "./evaluate";
import { renderMarkdown, renderVerdictJson } from "./render";
import { parseManifest } from "./parse-manifest";
import { parseRecords } from "./parse-records";
import { createManifestInput, createRecordsInput, fixtureTokenMetricVerifier } from "./test-support";

describe("rendering", () => {
  test("renders canonical byte-stable JSON without volatile fields or raw output", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);
    const evaluation = evaluate(manifest, records);

    const json = renderVerdictJson(evaluation);

    expect(json.endsWith("\n")).toBe(true);
    expect(json).not.toContain("durationMs");
    expect(json).not.toContain("stdout");
    expect(json).not.toContain("hostname");
    expect(JSON.parse(json).verdict.verdict).toBe("retain");
  });

  test("renders identical normalized records identically despite input ordering", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);

    const first = renderVerdictJson(evaluate(manifest, records));
    const second = renderVerdictJson(evaluate(manifest, [...records].reverse()));

    expect(second).toBe(first);
  });

  test("sorts incidents before canonical rendering", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput((scenarioId) => (scenarioId === "src-read-small" ? { markerDetected: true } : {})), manifest, undefined, fixtureTokenMetricVerifier);

    const first = renderVerdictJson(evaluate(manifest, records));
    const second = renderVerdictJson(evaluate(manifest, [...records].reverse()));

    expect(second).toBe(first);
  });

  test("renders deterministic Markdown with the machine verdict and metrics", () => {
    const manifest = parseManifest(createManifestInput());
    const records = parseRecords(createRecordsInput(), manifest, undefined, fixtureTokenMetricVerifier);
    const markdown = renderMarkdown(evaluate(manifest, records));

    expect(markdown).toContain("# Lean Context Evaluation");
    expect(markdown).toContain("retain");
    expect(markdown).toContain("25.00%");
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
