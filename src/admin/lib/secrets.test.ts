import { describe, expect, test } from "bun:test";
import { getSecretActivationStatus, isSecretKey, SECRETS_SCHEMA } from "./secrets";

describe("secrets schema", () => {
  test("covers the three password keys with activation statuses", () => {
    expect(SECRETS_SCHEMA.map((entry) => entry.key).sort()).toEqual([
      "ADMIN_PASSWORD",
      "OPENCHAMBER_UI_PASSWORD",
      "OPENCODE_SERVER_PASSWORD",
    ]);
    expect(getSecretActivationStatus("ADMIN_PASSWORD")).toBe("immediate");
    expect(getSecretActivationStatus("OPENCHAMBER_UI_PASSWORD")).toBe("restart_required");
    expect(getSecretActivationStatus("OPENCODE_SERVER_PASSWORD")).toBe("restart_required");
  });

  test("rejects unknown keys", () => {
    expect(isSecretKey("ADMIN_PASSWORD")).toBe(true);
    expect(isSecretKey("OPENCHAMBER_UI_PASSWORD")).toBe(true);
    expect(isSecretKey("DATABASE_URL")).toBe(false);
    expect(isSecretKey("")).toBe(false);
  });
});
