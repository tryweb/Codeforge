import { expect, test } from "bun:test";
import { buildLatestManifestCommand, LITERAL_LATEST_REF } from "./versions";

test("update checks always inspect the official latest image", () => {
  expect(LITERAL_LATEST_REF).toBe("ghcr.io/tryweb/ai-engkit:latest");
  expect(buildLatestManifestCommand()).toContain("manifest inspect ghcr.io/tryweb/ai-engkit:latest");
});
