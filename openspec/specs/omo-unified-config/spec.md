# OMO unified config

## Purpose

Ship pinned OMO agent defaults in a unified config while preserving user customizations and preventing legacy migration failures.

## Requirements

### Requirement: Ship OMO defaults in omo.jsonc format
AI-EngKit SHALL ship its OMO agent permission defaults as an omo.jsonc-format template (`.opencode/omo.jsonc.default`), baked into the image at `/etc/opencode/omo.jsonc.default`. The template SHALL contain the same 11 agent permission presets previously carried by `oh-my-openagent.json.default` (explore, oracle, librarian, multimodal-looker, metis, momus, prometheus as read-only/analysis; sisyphus, hephaestus, atlas, sisyphus-junior as execution).

#### Scenario: Image contains omo.jsonc default
- **WHEN** the Docker image is built
- **THEN** `/etc/opencode/omo.jsonc.default` exists, parses as valid JSONC, and contains permission entries for all 11 agents

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

### Requirement: Schema pinned to release tag
The `$schema` URL in the shipped omo.jsonc default SHALL reference the same verified tagged oh-my-openagent release as the runtime pin, not a floating branch such as `dev`.

#### Scenario: Schema URL is tag-pinned
- **WHEN** inspecting `/etc/opencode/omo.jsonc.default`
- **THEN** the `$schema` value contains the pinned release tag and does not contain `/dev/`

### Requirement: Coexistence with OMO legacy migration
AI-EngKit SHALL archive, but not import or delete, every recognized legacy OMO config filename before OMO starts. The archive SHALL remain within `~/.config/opencode` so the rename does not cross Docker volumes. AI-EngKit SHALL then generate unified defaults directly, leaving OMO no recognized legacy migration source.

#### Scenario: Existing legacy file auto-migrates once
- **WHEN** a container with a pre-existing legacy `oh-my-openagent.json` starts on the new image
- **THEN** the legacy file is present under an AI-EngKit backup suffix in `~/.config/opencode`, `~/.omo/omo.jsonc` contains the supported defaults, and OMO creates neither a migration journal nor an OMO migration backup

#### Scenario: Legacy file is preserved for manual recovery
- **WHEN** a container starts with a recognized legacy OMO config
- **THEN** its original content is retained under an AI-EngKit backup suffix in `~/.config/opencode` and is not imported into unified config

### Requirement: OMO version pinned and declared at runtime
The Dockerfile SHALL pin `OH_MY_OPENAGENT_VERSION=4.19.3` instead of `latest`. The entrypoint SHALL emit `oh-my-openagent@<pinned-version>` for an unset or bare `oh-my-openagent` plugin token; an explicitly versioned user token remains unchanged.

#### Scenario: Generated plugin declaration is pinned
- **WHEN** a container starts without an explicitly versioned OMO plugin token
- **THEN** generated `opencode.json` declares the same explicit version as `OH_MY_OPENAGENT_VERSION`, and `check-versions.sh` tracks that version against upstream
