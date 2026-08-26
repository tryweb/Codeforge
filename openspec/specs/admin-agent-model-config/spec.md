## Purpose

Let the Admin interface configure schema-valid primary models for live OMO subagents, compare persisted settings with live resolution, and verify that model selection reaches real child-session execution.

## Model Resolution Architecture

OMO subagent primary models use one canonical Admin-managed source:

| Layer | Source | Description |
|---|---|---|
| **Configured primary** | `~/.omo/omo.jsonc` → `agents.<name>.model` | Complete `provider/model` selected through Admin. |
| **Resolved model** | Managed OpenCode server `GET /agent` | Live provider and model after OMO applies configuration and provider availability. |
| **Executed model** | Completed child assistant message | Final execution evidence when the child is created without a request-level model. |

`[opencode].agents` is not a supported Admin model source. Invalid agent settings such as the legacy 4.19.4 `permission` field can prevent a configured primary from becoming effective and must be surfaced rather than silently accepted.

## Requirements

### Requirement: List agent model configuration
The system SHALL expose a read endpoint returning, for every live OMO subagent, its configured primary model from top-level `agents.<name>.model`, its currently resolved model from the managed OpenCode server `/agent` endpoint, and whether those values agree. A schema-invalid agent configuration SHALL be reported as invalid and SHALL NOT be presented as an effective configured model.

#### Scenario: List all agents with configured and resolved models
- **WHEN** `agents.librarian.model` is `opencode/nemotron-3.5-lightning-free` and the managed server reports the same provider and model for librarian
- **THEN** the response reports that model as configured and resolved, with an effective status

#### Scenario: Agent without configuration reports resolved plugin model
- **WHEN** a live OMO subagent has no top-level model configuration
- **THEN** its response has no configured primary, reports the live `/agent` provider and model, and identifies the source as plugin resolution

#### Scenario: Persisted and live models disagree
- **WHEN** `agents.librarian.model` contains Nemotron but the managed server reports `opencode-go/qwen3.7-plus`
- **THEN** the response reports both values and marks the configured model as not effective

#### Scenario: Invalid agent config is surfaced, not silently ignored
- **WHEN** an agent entry fails the pinned OMO schema
- **THEN** the response reports the validation failure and does not claim that agent's configured model is effective

### Requirement: Update agent model configuration
The system SHALL write at most one Admin-managed primary model to top-level `agents.<name>.model` in `~/.omo/omo.jsonc`. The target SHALL be a live OMO subagent and a submitted model SHALL be a complete `provider/model` identifier present in the active model catalog. The request `entries` array SHALL contain zero entries to clear the target Agent's model or one entry to set its primary model; the system SHALL reject multiple entries because the pinned OMO schema does not support a persisted fallback chain. A successful target-Agent write SHALL remove stale `models` and `fallback_models` keys from that target entry, leave unrelated Agents and supported settings unchanged, and preserve the file's `$schema` pin.

#### Scenario: Write replaces only the target agent's entries
- **WHEN** an authenticated admin selects `opencode/nemotron-3.5-lightning-free` for librarian
- **THEN** `agents.librarian.model` changes to that value, stale target-Agent chain keys are removed, and unrelated Agent settings remain unchanged

#### Scenario: Clear removes target model keys
- **WHEN** an authenticated admin submits an empty `entries` array for librarian
- **THEN** the system removes librarian's `model`, `variant`, `models`, and `fallback_models` keys without changing unrelated settings

#### Scenario: Reject multiple submitted models
- **WHEN** an admin submits more than one entry for an Agent
- **THEN** the system rejects the request with a 400 error and does not modify `~/.omo/omo.jsonc`

#### Scenario: Reject model outside active catalog
- **WHEN** an admin submits a missing-provider identifier or a model absent from the active catalog
- **THEN** the system rejects the request with a 400 error and does not modify `~/.omo/omo.jsonc`

#### Scenario: Write validates model and variant
- **WHEN** an admin submits a non-string model, a malformed provider/model identifier, or a deprecated variant value
- **THEN** the system rejects the request with a 400 error and does not modify `~/.omo/omo.jsonc`

#### Scenario: UI restricts model choices to connected providers
- **WHEN** an admin opens the selector for a live OMO subagent
- **THEN** only complete provider/model identifiers from the active model catalog are offered

#### Scenario: Reject non-subagent target
- **WHEN** an admin submits a model update for an Agent that is not a live OMO subagent
- **THEN** the system rejects the request and leaves the configuration unchanged

### Requirement: Apply confirmation and runtime reporting after restart
After an atomic write, the system SHALL restart only managed OpenCode and SHALL leave the `ai-dev` container running. It SHALL confirm that the replacement managed server is reachable, compare the live `/agent` and successful-request model metadata with the configured primary, and run the real temporary-session inference probe for that primary. The system SHALL restore the previous configuration and attempt to restore the previous managed runtime when the managed restart fails or the post-restart probe conclusively reports `unavailable` or `retired`. A runtime model mismatch SHALL be reported without rollback. A `retryable` or `unreachable` probe SHALL be reported as unverified without rollback.

#### Scenario: Apply is effective after restart
- **WHEN** the atomic write and managed restart succeed and resolution, successful-request metadata, and the real probe confirm the configured provider and model
- **THEN** the system reports the apply as verified and the `ai-dev` container remains running

#### Scenario: Apply persists but runtime differs
- **WHEN** the top-level model remains present after restart but `/agent`, successful-request metadata, or the probe resolves another model
- **THEN** the system reports both models as `runtime_mismatch` and does not roll back the persisted value

#### Scenario: Restart failure restores snapshot
- **WHEN** the atomic write succeeds but the managed restart fails
- **THEN** the system restores the previous `~/.omo/omo.jsonc`, attempts to restart managed OpenCode with that configuration, and reports `restart_failed`

#### Scenario: Conclusive unavailable probe restores snapshot
- **WHEN** the write and managed restart succeed but the post-restart probe reports `unavailable` or `retired`
- **THEN** the system restores the previous `~/.omo/omo.jsonc`, restarts managed OpenCode with that configuration, and reports `probe_failed`

#### Scenario: Inconclusive probe keeps applied configuration
- **WHEN** the write and managed restart succeed but the post-restart probe reports `retryable` or `unreachable`
- **THEN** the system keeps the applied configuration and reports `unverified`

#### Scenario: Rollback recovery failure is surfaced
- **WHEN** the system cannot restore the snapshot or cannot recover managed OpenCode after a rollback-triggering failure
- **THEN** the system reports `rollback_failed` and does not claim the new configuration is effective
### Requirement: Server password prerequisite for verification
The live-verification and list-resolved-model behaviors SHALL require `OPENCODE_SERVER_PASSWORD` to be set in the mounted `.env` (the password OpenChamber uses to spawn the managed opencode server). When it is absent, the system SHALL expose the configuration read/write of `~/.omo/omo.jsonc` but SHALL NOT claim live verification: the UI SHALL show a prerequisite warning and the write endpoint SHALL refuse to apply-and-restart with an explanatory error.

#### Scenario: Password present enables verification
- **WHEN** `.env` sets `OPENCODE_SERVER_PASSWORD` and the managed opencode server accepts Basic auth with `opencode:<password>`
- **THEN** the list endpoint returns live resolved models and the write endpoint performs apply-and-verify

#### Scenario: Password absent degrades gracefully
- **WHEN** `.env` does not set `OPENCODE_SERVER_PASSWORD`
- **THEN** the UI shows a prerequisite warning, the list endpoint returns no live resolved model, and the write endpoint rejects apply with an error explaining the missing variable

### Requirement: End-to-end regression test
The test suite SHALL include an end-to-end test that snapshots `~/.omo/omo.jsonc`, configures librarian to `opencode/nemotron-3.5-lightning-free`, restarts the managed service, verifies the live `/agent` model, and creates a real librarian child session without supplying an explicit model. The test SHALL pass only when a completed assistant message records provider `opencode` and model `nemotron-3.5-lightning-free`. Trap-based cleanup SHALL restore the byte-identical baseline and remove test sessions on every exit path.

#### Scenario: Test passes through set-confirm-restore
- **WHEN** the regression test prompts a librarian child session after a successful restart
- **THEN** the completed assistant message records `opencode/nemotron-3.5-lightning-free`, the baseline is restored, and the managed server is reachable

#### Scenario: Test skips without password
- **WHEN** `OPENCODE_SERVER_PASSWORD` is unavailable
- **THEN** the test is skipped with a warning naming the prerequisite and leaves `~/.omo/omo.jsonc` untouched

#### Scenario: Fallback execution fails verification
- **WHEN** the child assistant message records `opencode-go/qwen3.7-plus` or any model other than the configured model
- **THEN** the test fails and restores the original configuration

#### Scenario: Cleanup runs after verification failure
- **WHEN** any write, restart, reachability, live-model, or child-session assertion fails
- **THEN** the baseline file is restored byte-for-byte and created verification sessions are deleted
