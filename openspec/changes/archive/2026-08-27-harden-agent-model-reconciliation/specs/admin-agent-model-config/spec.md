## MODIFIED Requirements

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
