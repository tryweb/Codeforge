## Purpose

Lets the Admin interface read and write per-OMO-agent default and fallback model configuration, with live verification that the configured model actually takes effect.

## ADDED Requirements

### Requirement: List agent model configuration
The system SHALL expose a read endpoint returning, for every OMO agent, its configured `fallback_models` (from `~/.omo/omo.jsonc`), its currently resolved model (from the managed opencode server `/agent` endpoint), and whether the resolved model is configured, inherited, or plugin-assigned. The response SHALL also indicate whether the connected-provider set makes the configured entries resolvable.

#### Scenario: List all agents with configured and resolved models
- **WHEN** an authenticated admin requests the agent model list and `~/.omo/omo.jsonc` contains `agents.plan.fallback_models` while the managed opencode server reports `plan` running `opencode-go/kimi-k3`
- **THEN** the response contains a `plan` entry whose `configured` array equals the file's `fallback_models`, whose `resolved` equals `{modelID: "kimi-k3", providerID: "opencode-go"}`, and whose source is `configured`

#### Scenario: Agent without configuration reports resolved plugin model
- **WHEN** an agent (e.g. `oracle`) has no `fallback_models` in `~/.omo/omo.jsonc`
- **THEN** its response entry has an empty `configured` array, its `resolved` equals the live `/agent` value, and its source is `plugin`

### Requirement: Update agent model configuration
The system SHALL expose a write endpoint accepting a per-agent list of `{model, variant?}` entries. A write SHALL apply only to the target agent's `fallback_models` key in `~/.omo/omo.jsonc`, leaving every other key and agent unchanged, and SHALL preserve the file's `$schema` pin. An empty list SHALL remove the agent's `fallback_models` key (returning the agent to plugin-assigned models). After a successful write the system SHALL restart the ai-dev service. The Admin UI SHALL restrict the model choices offered for an agent to models present in the catalogs of currently connected providers; the write endpoint SHALL NOT apply that restriction (any syntactically valid model string is accepted).

#### Scenario: Write replaces only the target agent's entries
- **WHEN** an authenticated admin submits entries for `sisyphus` while `~/.omo/omo.jsonc` also configures `prometheus`
- **THEN** only `agents.sisyphus.fallback_models` changes; `agents.prometheus` and the `$schema` value are byte-identical afterwards

#### Scenario: Empty list removes configuration
- **WHEN** an authenticated admin submits an empty entry list for `plan`
- **THEN** `agents.plan.fallback_models` no longer exists in `~/.omo/omo.jsonc`

#### Scenario: Write validates model and variant
- **WHEN** an admin submits an entry whose `model` is not a string or whose `variant` is outside `low`, `medium`, `high`, `xhigh`, `max`
- **THEN** the system rejects the request with a 400 error and does not modify `~/.omo/omo.jsonc`

#### Scenario: UI restricts model choices to connected providers
- **WHEN** an admin opens the model selector for an agent while `openai` and `opencode-go` are connected
- **THEN** only models from the `openai` and `opencode-go` catalogs are offered, and a model absent from both cannot be selected

### Requirement: Apply confirmation and rollback after restart
After writing and restarting, the system SHALL confirm that the write landed (the target agent's `fallback_models` entries are present in `~/.omo/omo.jsonc`), that the restart succeeded, and that the managed opencode server is reachable again (it re-reads config from disk on restart). The `/agent` model report SHALL be treated as informational only: it reflects the plugin's default model resolution (AGENT_MODEL_REQUIREMENTS), not `fallback_models`, so it SHALL NOT be used to judge whether a write succeeded or to trigger a rollback. The system SHALL restore the previous `~/.omo/omo.jsonc` content only when the write itself fails or the restart fails, and SHALL report the failure.

#### Scenario: Apply confirmed after successful write and restart
- **WHEN** an admin sets `explore.fallback_models` to `[{model: "claude-opus-5"}]` and the write, restart, and server reachability all succeed
- **THEN** the system reports the apply as confirmed, and a reported current model that differs from the configured entries does not trigger a rollback

#### Scenario: Write failure reports without changing configuration
- **WHEN** the jq write to `~/.omo/omo.jsonc` fails
- **THEN** the system reports a write failure and the file is unchanged (no restart, no rollback needed)

#### Scenario: Restart failure restores the snapshot
- **WHEN** the write succeeds but the ai-dev restart fails
- **THEN** the system restores the previous `~/.omo/omo.jsonc` content and reports the restart failure

#### Scenario: Server unreachable after restart is reported without rollback
- **WHEN** the restart succeeds but the managed opencode `/agent` endpoint cannot be reached afterwards
- **THEN** the system reports the apply as confirmed-but-unverified without restoring the configuration

### Requirement: Server password prerequisite for verification
The live-verification and list-resolved-model behaviors SHALL require `OPENCODE_SERVER_PASSWORD` to be set in the mounted `.env` (the password OpenChamber uses to spawn the managed opencode server). When it is absent, the system SHALL expose the configuration read/write of `~/.omo/omo.jsonc` but SHALL NOT claim live verification: the UI SHALL show a prerequisite warning and the write endpoint SHALL refuse to apply-and-restart with an explanatory error.

#### Scenario: Password present enables verification
- **WHEN** `.env` sets `OPENCODE_SERVER_PASSWORD` and the managed opencode server accepts Basic auth with `opencode:<password>`
- **THEN** the list endpoint returns live resolved models and the write endpoint performs apply-and-verify

#### Scenario: Password absent degrades gracefully
- **WHEN** `.env` does not set `OPENCODE_SERVER_PASSWORD`
- **THEN** the UI shows a prerequisite warning, the list endpoint returns no live resolved model, and the write endpoint rejects apply with an error explaining the missing variable

### Requirement: End-to-end regression test
The test suite SHALL include an end-to-end script that (1) records the baseline `~/.omo/omo.jsonc` and the live `/agent` model for a target agent, (2) writes a valid configuration, (3) restarts and confirms the managed server answers `/agent` again (config re-read) and the config file retains the target, and (4) restores the baseline and asserts the file is byte-identical and the server is reachable. Restoration SHALL be guaranteed even if confirmation fails (trap-based cleanup), and the script SHALL skip with a warning when `OPENCODE_SERVER_PASSWORD` is absent. The script SHALL NOT assert a model change via `/agent` — that endpoint never reflects `fallback_models`.

#### Scenario: Test passes through set-confirm-restore
- **WHEN** the test runs on an environment with `OPENCODE_SERVER_PASSWORD` set and a writable ai-dev
- **THEN** it exits 0 only if the target is retained in config and the server answers `/agent` after restart, and the baseline is restored afterwards

#### Scenario: Test skips without password
- **WHEN** the test runs without `OPENCODE_SERVER_PASSWORD` in `.env`
- **THEN** it exits non-zero with a warning naming the missing variable, or is skipped by the runner, and leaves `~/.omo/omo.jsonc` untouched
