## MODIFIED Requirements

### Requirement: Ship OMO defaults in omo.jsonc format
AI-EngKit SHALL ship its OMO agent defaults as an omo.jsonc-format template (`.opencode/omo.jsonc.default`), baked into the image at `/etc/opencode/omo.jsonc.default`. The template SHALL contain the same 11 agent presets previously carried by `oh-my-openagent.json.default` (explore, oracle, librarian, multimodal-looker, metis, momus, prometheus as read-only/analysis; sisyphus, hephaestus, atlas, sisyphus-junior as execution). The template SHALL conform to the schema of the pinned oh-my-openagent release: agent entries SHALL NOT contain a `permission` key (unrecognized by the 4.19.4 `OmoAgentDefInputSchema`), and model chains SHALL use the `models` key (or `model` for a single entry) instead of the deprecated `fallback_models` key.

#### Scenario: Image contains omo.jsonc default
- **WHEN** the Docker image is built
- **THEN** `/etc/opencode/omo.jsonc.default` exists, parses as valid JSONC, contains entries for all 11 agents, contains no `permission` key on any agent, and passes `oh-my-opencode config migrate --dry-run` with no validation errors

#### Scenario: Legacy template no longer installed to runtime config
- **WHEN** a container starts from the image
- **THEN** the entrypoint does not create or update `~/.config/opencode/oh-my-openagent.json`

### Requirement: Runtime omo.jsonc generation and merge
The entrypoint (`entrypoint.d/02-init-config.sh`) SHALL ensure `~/.omo/omo.jsonc` exists at container start: if the file is missing or lacks an `agents` key, the entrypoint SHALL shallow-merge the baked default under the user's existing content (user keys win). If the user's omo.jsonc already contains `agents`, the entrypoint SHALL leave it unmodified.

#### Scenario: First start creates omo.jsonc from default
- **WHEN** a container starts with an empty `~/.omo/`
- **THEN** `~/.omo/omo.jsonc` is created containing the shipped agent presets

#### Scenario: User customizations preserved across restarts
- **WHEN** the user has edited `~/.omo/omo.jsonc` and the container restarts
- **THEN** the user's `agents` content is preserved verbatim (no overwrite, no re-merge)

#### Scenario: Idempotent repeated starts
- **WHEN** the container starts twice in a row without user edits
- **THEN** `~/.omo/omo.jsonc` content is byte-identical after both starts

### Requirement: OMO version pinned and declared at runtime
The Dockerfile SHALL pin `OH_MY_OPENAGENT_VERSION` to the currently verified release (4.19.4). The entrypoint SHALL emit `oh-my-openagent@<pinned-version>` for an unset or bare `oh-my-openagent` plugin token; an explicitly versioned user token remains unchanged. The shipped omo.jsonc default `$schema` SHALL reference the same pinned version tag.

#### Scenario: Generated plugin declaration is pinned
- **WHEN** a container starts without an explicitly versioned OMO plugin token
- **THEN** generated `opencode.json` declares the same explicit version as `OH_MY_OPENAGENT_VERSION`, and `check-versions.sh` tracks that version against upstream

#### Scenario: Default schema matches runtime pin
- **WHEN** inspecting `/etc/opencode/omo.jsonc.default`
- **THEN** its `$schema` URL references the same version tag as `OH_MY_OPENAGENT_VERSION`
