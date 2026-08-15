## MODIFIED Requirements

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
The system SHALL write an Admin-managed primary model to top-level `agents.<name>.model` in `~/.omo/omo.jsonc`. The target SHALL be a live OMO subagent and the model SHALL be a complete `provider/model` identifier present in the active model catalog. The write SHALL leave unrelated agents and supported agent settings unchanged and SHALL preserve the file's `$schema` pin.

#### Scenario: Write replaces only the target agent's entries
- **WHEN** an authenticated admin selects `opencode/nemotron-3.5-lightning-free` for librarian
- **THEN** only `agents.librarian.model` changes and unrelated agent settings remain unchanged

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
- **WHEN** an admin submits a model update for an agent that is not a live OMO subagent
- **THEN** the system rejects the request and leaves the configuration unchanged

### Requirement: Apply confirmation and runtime reporting after restart
After writing and restarting, the system SHALL confirm that the target top-level model is present, the restart succeeded, and the managed server is reachable. It SHALL then compare the live `/agent` model with the configured model. A mismatch SHALL be reported as an applied-but-runtime-mismatch result and SHALL NOT silently be reported as success. The previous configuration SHALL be restored only when the atomic write or service restart fails.

#### Scenario: Apply is effective after restart
- **WHEN** the write and restart succeed and `/agent` reports the configured provider and model
- **THEN** the system reports the apply as effective

#### Scenario: Apply persists but runtime differs
- **WHEN** the top-level model remains present after restart but `/agent` reports another model
- **THEN** the system reports both models and an applied-but-runtime-mismatch result without rolling back the persisted value

#### Scenario: Restart failure restores snapshot
- **WHEN** the write succeeds but the service restart fails
- **THEN** the system restores the previous `~/.omo/omo.jsonc` content and reports the restart failure

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
