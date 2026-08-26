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
  console.error(
    `[agent-models] reconciled: changed=${summary.changed} applied=${summary.applied} failed=${summary.failed}`,
  );
} catch (error) { // no-excuse-ok: catch
  console.error("[agent-models] reconciliation failed", error);
  process.exitCode = 1;
}
