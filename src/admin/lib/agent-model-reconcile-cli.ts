import { createAgentModelReconciler } from "./agent-model-reconciler";
import { REAL_DEPS } from "./agent-models";

// The CLI runs inside the ai-dev container, which has no /opt/ai-engkit/.env
// file (only the admin container mounts it); read the password from the
// process environment instead.
const deps = {
  ...REAL_DEPS,
  readEnv: (): Record<string, string> => ({ ...process.env }) as Record<string, string>,
};

try {
  const summary = await createAgentModelReconciler(deps).reconcileAll();
  for (const result of summary.results) {
    console.error(
      `[agent-models] result ${JSON.stringify({
        agent: result.agent,
        status: result.status,
        error: result.error,
        resolved: result.resolved === null
          ? null
          : `${result.resolved.providerID}/${result.resolved.modelID}`,
      })}`,
    );
  }
  console.error(
    `[agent-models] reconciled: changed=${summary.changed} applied=${summary.applied} failed=${summary.failed}`,
  );
  if (summary.failed > 0) process.exitCode = 1;
} catch (error) { // no-excuse-ok: catch
  console.error("[agent-models] reconciliation failed", error);
  process.exitCode = 1;
}
