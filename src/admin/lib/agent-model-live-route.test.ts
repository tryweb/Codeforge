import { describe, expect, test } from "bun:test";
import { createAgentModelLiveClient } from "./agent-model-live";

describe("buildRequestVerificationScript agent routing", () => {
  test("message POST body carries the agent so verification runs as the specified agent", async () => {
    const exec = async (command: string, _timeoutMs: number) => {
      expect(command).toContain('jq -nc --arg agent "$AGENT"');
      expect(command).toContain('{agent:$agent,parts:[{type:"text",text:"Reply with exactly OK."}]}');
      expect(command).toContain("SESSION");
      return { exitCode: 0, stdout: JSON.stringify({ info: { role: "assistant", modelID: "mimo-v2.5-free", providerID: "opencode" } }), stderr: "" };
    };
    const lib = createAgentModelLiveClient({ exec });
    const result = await lib.fetchSuccessfulRequestModel("pass", "explore");
    expect(result).toEqual({ modelID: "mimo-v2.5-free", providerID: "opencode" });
  });
});