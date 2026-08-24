import { describe, expect, it } from "bun:test";
import { isKeyProviderSupported } from "./opencode-auth";

describe("isKeyProviderSupported", () => {
  it("supports Nvidia API keys", () => {
    expect(isKeyProviderSupported("nvidia")).toBe(true);
  });
});
