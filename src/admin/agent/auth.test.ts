import { describe, expect, it } from "bun:test";
import { hostname } from "node:os";
import { redactTokenForLogging, resolveAgentId, resolveRegistrationToken } from "./auth";

describe("agent authentication", () => {
  it("prefers the URL registration token over the environment", () => {
    const token = resolveRegistrationToken("wss://center.example.com/ws?token=url-token", {
      CENTER_TOKEN: "environment-token",
    });

    expect(token).toBe("url-token");
  });

  it("falls back to the environment registration token", () => {
    const token = resolveRegistrationToken("wss://center.example.com/ws", {
      CENTER_TOKEN: "environment-token",
    });

    expect(token).toBe("environment-token");
  });

  it("returns null when no registration token is available", () => {
    expect(resolveRegistrationToken("not a url", {})).toBeNull();
  });

  it("uses a configured non-empty agent id", () => {
    expect(resolveAgentId({ AGENT_ID: "agent-12" })).toBe("agent-12");
  });

  it("falls back to the hostname for an absent or empty agent id", () => {
    expect(resolveAgentId({})).toBe(hostname());
    expect(resolveAgentId({ AGENT_ID: "" })).toBe(hostname());
  });

  it("redacts registration tokens for logging", () => {
    expect(redactTokenForLogging(null)).toBe("(none)");
    expect(redactTokenForLogging("secret-token")).toBe("sec…");
    expect(redactTokenForLogging("ab")).toBe("ab…");
  });
});
