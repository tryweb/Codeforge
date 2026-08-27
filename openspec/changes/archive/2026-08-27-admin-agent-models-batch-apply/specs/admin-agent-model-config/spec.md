## MODIFIED Requirements

### Requirement: Update agent model configuration
The system SHALL allow configuring primary models for live OMO subagents via single-agent PUT /api/agent-models/:agent and batch PUT /api/agent-models. Each target SHALL be a live OMO subagent and each submitted model SHALL be a complete provider/model identifier present in the active model catalog. The request entries array for each agent SHALL contain zero entries to clear the target Agent's model or one entry to set its primary model; the system SHALL reject multiple entries per agent because the pinned OMO schema does not support a persisted fallback chain. A successful batch write SHALL remove stale models and fallback_models keys only from the targeted entries, leave unrelated Agents and supported settings unchanged, and preserve the file's $schema pin. The single-agent endpoint SHALL remain as a compatibility path.

#### Scenario: Write replaces only the target agent's entries
- **WHEN** an authenticated admin selects opencode/nemotron-3.5-lightning-free for librarian via the single-agent endpoint
- **THEN** agents.librarian.model changes to that value, stale target-Agent chain keys are removed, and unrelated Agent settings remain unchanged

#### Scenario: Batch write replaces only targeted agents
- **WHEN** an authenticated admin submits a batch with three agents each with one valid model
- **THEN** each targeted agents.*.model changes to its submitted value in one atomic write, stale chain keys are removed only for those targets, and unrelated Agent settings remain unchanged

#### Scenario: Clear removes target model keys
- **WHEN** an authenticated admin submits an empty entries array for librarian (single) or includes librarian with empty entries in a batch
- **THEN** the system removes librarian's model, variant, models, and fallback_models keys without changing unrelated settings

#### Scenario: Reject multiple submitted models
- **WHEN** an admin submits more than one entry for an Agent in either single or batch form
- **THEN** the system rejects the request with a 400 error and does not modify ~/.omo/omo.jsonc

#### Scenario: Reject model outside active catalog
- **WHEN** an admin submits a missing-provider identifier or a model absent from the active catalog in either single or batch form
- **THEN** the system rejects the request with a 400 error and does not modify ~/.omo/omo.jsonc

#### Scenario: Write validates model and variant
- **WHEN** an admin submits a non-string model, a malformed provider/model identifier, or a deprecated variant value in either single or batch form
- **THEN** the system rejects the request with a 400 error and does not modify ~/.omo/omo.jsonc

#### Scenario: UI restricts model choices to connected providers
- **WHEN** an admin opens the selector for a live OMO subagent
- **THEN** only complete provider/model identifiers from the active model catalog are offered, and the UI collects changes locally as pending until Apply

#### Scenario: Reject non-subagent target
- **WHEN** an admin submits a model update for an Agent that is not a live OMO subagent in either single or batch form
- **THEN** the system rejects the request and leaves the configuration unchanged
