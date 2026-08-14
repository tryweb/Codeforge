## 1. Admin library layer (`src/admin/lib/agent-models.ts`)

- [ ] 1.1 Implement `readAgentModelsConfig()` — reads `~/.omo/omo.jsonc` via `execInAiDev` and returns the current `agents` block (or a typed empty map when the file/agents key is absent); verify with a unit test against a stubbed `execInAiDev`
- [ ] 1.2 Implement `writeAgentFallbackModels(agent, entries)` — targeted jq update of `agents.<name>.fallback_models` (temp file + atomic `mv`), deleting the key when `entries` is empty, preserving all other keys and the `$schema` pin; verify the jq command is generated correctly for both set and delete cases in a unit test
- [ ] 1.3 Implement `snapshotAgentModelsConfig()` / `restoreAgentModelsConfig(snapshot)` — copy current file content to `admin-data` before writes and restore it back through `execInAiDev`; verify both helpers round-trip in a unit test
- [ ] 1.4 Implement `validateFallbackModels(input)` — rejects non-string `model` and `variant` outside `low|medium|high|xhigh|max` with a 400-style error message; verify reject/accept cases in a unit test
- [ ] 1.5 Implement `getServerPassword()` — reads `OPENCODE_SERVER_PASSWORD` from the mounted `/opt/ai-engkit/.env` (via existing `readEnvFile`) and returns it or `null`; verify with a temp-env unit test
- [ ] 1.6 Implement `fetchResolvedAgentModels()` — discovers the managed opencode port from `~/.config/openchamber/managed-opencode/*.json` (via `execInAiDev`, picking the live PID), polls readiness, then GETs `/agent` with `Authorization: Basic base64("opencode:<password>")` and returns `{name → {modelID, providerID}}`; verify header/port parsing in a unit test with injected fetch
- [ ] 1.7 Implement `applyAndVerify(agent, entries)` orchestration — snapshot → write → `restartAiDev()` → re-discover port → fetch resolved models → compare written agent's resolved model against the configured primary; on **mismatch** restore snapshot → restart → return expected-vs-actual with a reason distinguishing "model unavailable on connected providers" from other verification failures; on **fetch failure** do NOT roll back — report the config as applied but unverified; verify the three outcomes (success / mismatch-rollback / fetch-failure-report) in a unit test with injected deps

## 2. Admin routes (`src/admin/routes/agent-models.ts` + wiring)

- [ ] 2.1 Create `createAgentModelsRoutes(deps)` with `GET /api/agent-models` — returns per-agent `{configured, resolved, source}` for all OMO agents (union of the configured agents and the live `/agent` names), omitting `resolved` when no server password is configured; verify via `src/admin/routes/agent-models.test.ts` with stub deps (pattern: existing `agent.test.ts`)
- [ ] 2.2 Add `PUT /api/agent-models/:agent` — validates via `validateFallbackModels`, returns 400 on invalid input without touching the file, returns 409 with an explanatory error when `OPENCODE_SERVER_PASSWORD` is absent (degraded mode), otherwise runs `applyAndVerify` and returns the verification result including expected-vs-actual on rollback
- [ ] 2.3 Add `GET /agent-models` page route rendering the view (below) with initial data from the list endpoint
- [ ] 2.4 Wire `createAgentModelsRoutes` into `src/admin/server.ts` alongside the existing route mounts; verify with `bun run typecheck` and the existing admin route tests staying green

## 3. Admin view (`src/admin/views/agent-models.tsx` + navigation)

- [ ] 3.1 Build `AgentModelsPage` (pattern: `providers.tsx`/`env-editor.tsx`) — table of all OMO agents with columns: agent, configured chain (model + variant), resolved model (from list data), source badge (configured/inherited/plugin); show a prerequisite warning banner when the server password is missing
- [ ] 3.2 Add per-agent edit affordance — model select (filtered to connected-provider catalog entries), optional variant select (low/medium/high/xhigh/max), add/remove chain rows, save/cancel; pattern: env-editor modal
- [ ] 3.3 Implement save flow — confirm dialog warning about ai-dev restart interrupting sessions ("Save & Restart"), PUT to the API, show "Restarting…" state, then render the verification result (success with new resolved model, or rollback with expected-vs-actual); on 409 show the prerequisite error
- [ ] 3.4 Add nav entry `{ href: "/agent-models", label: "Agent Models", icon: "◈" }` to `NAV_ITEMS` in `src/admin/views/layout.tsx`; verify the page renders via the running admin server in dev

## 4. Tests and verification

- [ ] 4.1 Write `src/admin/routes/agent-models.test.ts` covering: list merges configured + resolved, degraded mode omits resolved, PUT validates (400) and rejects without password (409), apply success/rollback outcomes via injected deps; all pass
- [ ] 4.2 Write `test/test-agent-model-e2e.sh` — baseline snapshot + live `/agent` read; set a valid `fallback_models` for a disposable agent (e.g. `plan`); restart; re-read port and assert resolved model equals configured primary via `/agent`; restore baseline; restart; assert original model; `trap`-guaranteed restore on any failure; skip-with-warning when `OPENCODE_SERVER_PASSWORD` is absent
- [ ] 4.3 Run the full suite (`test/run-tests.sh`) — new route unit tests and e2e script pass, existing 142+ tests stay green
- [ ] 4.4 Manual end-to-end sanity on the dev environment: open `/agent-models`, set a model for one agent, confirm restart + verification result, then revert via the UI; capture the before/after resolved models as evidence
