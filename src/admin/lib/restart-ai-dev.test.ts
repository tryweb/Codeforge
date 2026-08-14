import { describe, expect, test } from "bun:test";
import type { ExecResult } from "./docker";
import { restartAiDev, type AiDevRestartDeps } from "./restart-ai-dev";

const OK: ExecResult = { stdout: "", stderr: "", exitCode: 0 };

function createDeps(composeFileExists: boolean): {
  readonly deps: AiDevRestartDeps;
  readonly commands: Array<{ readonly command: string; readonly timeoutMs: number }>;
} {
  const commands: Array<{ readonly command: string; readonly timeoutMs: number }> = [];
  return {
    deps: {
      composeFileExists: () => composeFileExists,
      getAiDevContainerRef: async () => "ai-dev-ref",
      getComposeProject: async () => "project-name",
      dockerCommand: async (command, timeoutMs) => {
        commands.push({ command, timeoutMs });
        return OK;
      },
    },
    commands,
  };
}

describe("restartAiDev", () => {
  test("recreates the ai-dev compose service when the compose file exists", async () => {
    // Given
    const fixture = createDeps(true);

    // When
    const result = await restartAiDev(fixture.deps);

    // Then
    expect(result).toEqual({ ok: true });
    expect(fixture.commands).toEqual([{
      command: "compose -p project-name --env-file /opt/ai-engkit/.env -f /opt/ai-engkit/compose.yml up -d --force-recreate ai-dev 2>&1",
      timeoutMs: 120_000,
    }]);
  });

  test("restarts the container directly when the compose file is absent", async () => {
    // Given
    const fixture = createDeps(false);

    // When
    const result = await restartAiDev(fixture.deps);

    // Then
    expect(result).toEqual({ ok: true });
    expect(fixture.commands).toEqual([{
      command: "restart ai-dev-ref",
      timeoutMs: 30_000,
    }]);
  });
});
