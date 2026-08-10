import { describe, expect, test } from "bun:test";
import { redactEnvVars } from "./env-redact";
import { maskKey } from "./provider-keys";
import { PROVIDER_ENV_KEY } from "./providers";

describe("redactEnvVars", () => {
  test("preserves non-secret keys untouched", () => {
    const out = redactEnvVars({ ADMIN_PORT: "8080", WORKSPACE_PATH: "/srv/ws", APT_PACKAGES: "jq" });
    expect(out.ADMIN_PORT).toBe("8080");
    expect(out.WORKSPACE_PATH).toBe("/srv/ws");
    expect(out.APT_PACKAGES).toBe("jq");
  });

  test("masks password-typed schema keys with maskKey (first 4 + last 4)", () => {
    const out = redactEnvVars({ ADMIN_PASSWORD: "supersecretvalue" });
    expect(out.ADMIN_PASSWORD).toBe(maskKey("supersecretvalue"));
    expect(out.ADMIN_PASSWORD).toBe("supe…alue");
    expect(JSON.stringify(out)).not.toContain("supersecretvalue");
  });

  test("redacts OPENCODE_PROVIDER entirely", () => {
    const providerJson = '{"openai":{"options":{"apiKey":"sk-raw-key-material"}}}';
    const out = redactEnvVars({ [PROVIDER_ENV_KEY]: providerJson, ADMIN_PORT: "8080" });
    expect(PROVIDER_ENV_KEY in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain("sk-raw-key-material");
    expect(out.ADMIN_PORT).toBe("8080");
  });

  test("passwords of 8 characters or fewer become bullet-only", () => {
    const out = redactEnvVars({ OPENCHAMBER_UI_PASSWORD: "short123", OPENCODE_SERVER_PASSWORD: "tiny" });
    expect(out.OPENCHAMBER_UI_PASSWORD).toMatch(/^•+$/);
    expect(out.OPENCHAMBER_UI_PASSWORD).toHaveLength(8);
    expect(out.OPENCODE_SERVER_PASSWORD).toMatch(/^•+$/);
  });

  test("does not mutate the input map", () => {
    const vars = { ADMIN_PASSWORD: "supersecretvalue", ADMIN_PORT: "8080" };
    redactEnvVars(vars);
    expect(vars.ADMIN_PASSWORD).toBe("supersecretvalue");
  });
});
