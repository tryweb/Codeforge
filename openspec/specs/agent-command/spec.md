## Purpose

Defines command dispatch on the ai-admin agent: parsing and routing of `command` messages from the Center Server to the `upgrade`, `reconfigure`, and `restart` handlers, and the in-memory FIFO deferral queue that holds commands blocked by an in-progress upgrade or a dropped connection.
## Requirements

> **Container naming.** The agent module operates in the production environment only. Compose services `ai-dev` and `ai-admin` correspond to the production containers `ai-engkit` and `ai-engkit-admin`. The test/dev containers (`ai-engkit-dev`, `ai-engkit-admin-dev`) are used only while developing or testing the module itself; the existing sibling-name convention (`getSiblingDevContainerName`) derives the correct container from the admin container's own name, so a development run targets the dev containers and never production.

### Requirement: Commands are parsed and routed to handlers

The agent SHALL accept `command` messages from the Center Server and route each to the handler named by the `type` field in the command payload. Action command types are `upgrade`, `reconfigure`, `restart`, `providers.key.add`, `providers.key.set-active`, `providers.key.delete`, `providers.key.update-note`, `secrets.set`, `ssh.key.add`, `ssh.key.delete`, `git.config.set`, `gh.auth.start`, `gh.auth.logout`, `glab.instance.add`, `glab.instance.remove`, `projects.create`, `projects.set-remote`, `projects.enable`, `projects.disable`, `projects.enable-feature`, and `projects.sync`; action outcomes SHALL be reported with `ack`. Query command types are `status`, `env.get`, `projects.list`, `providers.list`, `git.config.get`, `glab.instances`, and `ssh.key.list`; query outcomes SHALL be reported with `result` and SHALL NOT produce an `ack`. Any other command type SHALL be rejected with an `error` using code `unknown_command` and SHALL have no side effects.

#### Scenario: Known action command is routed
- **WHEN** a `command` message whose payload type is an action command is received
- **THEN** the corresponding action handler is invoked with the command payload
- **AND** the outcome is reported with `ack`

#### Scenario: Known query command is routed
- **WHEN** a `command` message whose payload type is a query command is received
- **THEN** the corresponding read-only handler is invoked with the command payload
- **AND** the outcome is reported with `result`
- **AND** no `ack` is sent

#### Scenario: Unknown command is rejected
- **WHEN** a command message names a type outside the action and query command sets
- **THEN** the agent responds with an `error` (code `unknown_command`)
- **AND** no handler is invoked and no state is modified

### Requirement: Provider key commands mutate the shared key registry

The agent SHALL route `providers.key.add`, `providers.key.set-active`,
`providers.key.delete`, and `providers.key.update-note` to handlers that
mutate the shared `provider-keys.json` registry through the same library
functions the local admin API uses, restricted to key-managed providers
(`isKeyProviderSupported()`, initially `opencode-go`). A command naming any
other provider SHALL be rejected with `error` `malformed_command` before any
mutation.

#### Scenario: add a key
- **WHEN** a `providers.key.add` command with a valid provider, a non-empty
  `value`, and an optional `note` is received
- **THEN** the key is appended to the registry
- **AND** the current active selection is unchanged
- **AND** if it is the provider's first key, the key is applied to the auth
  store and ai-dev is restarted per the command's restart mode

#### Scenario: add rejects an empty key
- **WHEN** a `providers.key.add` command carries an empty or non-string `value`
- **THEN** no registry change is made and an `error` (`malformed_command`) is sent

#### Scenario: first-key add rejects an unknown auth-store credential
- **WHEN** the registry has no keys for the provider but the ai-dev auth store
  already holds a key for it
- **THEN** the add is rejected with an `error` describing the collision, and
  no registry change is made

#### Scenario: update note
- **WHEN** a `providers.key.update-note` command names an existing key id and
  a string `note`
- **THEN** the key's note is updated in the registry
- **AND** no apply and no restart are performed

#### Scenario: set active key
- **WHEN** a `providers.key.set-active` command names an existing key id
- **THEN** the selection is persisted in the registry
- **AND** the key is applied to the ai-dev auth store
- **AND** ai-dev is restarted per the command's restart mode

#### Scenario: set-active rolls back on apply failure
- **WHEN** applying the selected key to the auth store or restarting fails
- **THEN** the previous active selection is restored in the registry
- **AND** an `ack` reporting the failure is sent

#### Scenario: delete a key
- **WHEN** a `providers.key.delete` command names an existing key id
- **THEN** the key is removed from the registry
- **AND** if the removed key was active, the next key is promoted and applied
  to the auth store, and ai-dev is restarted per the command's restart mode

#### Scenario: delete the last key
- **WHEN** a `providers.key.delete` command removes the provider's only key
- **THEN** the provider's entry is removed from the auth store, the provider
  cache is cleared, and ai-dev is restarted per the command's restart mode

#### Scenario: delete a non-active key
- **WHEN** a `providers.key.delete` command removes a key that is not active
- **THEN** the registry is updated
- **AND** no apply and no restart are performed

### Requirement: Key-change restarts respect a restart mode

`providers.key.set-active` and `providers.key.delete` SHALL accept a `mode`
field of `"graceful"` or `"force"`, defaulting to `"graceful"`. A `graceful`
restart SHALL wait until every non-archived OpenChamber session reports an
idle status (polled via the OpenChamber control API), then stop the ai-dev
container cleanly before recreation. A `force` restart SHALL recreate the
ai-dev container immediately, as the current restart behavior does. If a
graceful wait exceeds its deadline or the control API is unavailable, the
agent SHALL fall back to a force restart and report that in the final `ack`.

#### Scenario: graceful is the default
- **WHEN** a key-change command triggers a restart without a `mode` field
- **THEN** the agent waits for all sessions to be idle before restarting

#### Scenario: graceful waits for busy sessions
- **WHEN** a graceful restart is requested and at least one session reports a
  non-idle status
- **THEN** the agent keeps polling until all sessions report idle or the
  deadline is reached

#### Scenario: graceful deadline falls back to force
- **WHEN** sessions remain non-idle past the graceful-wait deadline
- **THEN** the agent performs a force restart
- **AND** the final `ack` states that the force fallback was used

#### Scenario: force restarts immediately
- **WHEN** a key-change command carries `mode: "force"`
- **THEN** the ai-dev container is recreated immediately without waiting

### Requirement: Provider key handlers reuse the shared registry and apply pipeline

Provider key handlers SHALL call the registry mutation and auth-store apply
functions exported from `src/admin/lib/provider-keys.ts` and
`src/admin/lib/opencode-auth.ts` — the same functions the local admin routes
use — and SHALL NOT reimplement registry or auth-store logic.

#### Scenario: shared mutation functions are used
- **WHEN** a provider key command executes
- **THEN** it calls the shared registry/apply library functions rather than
  duplicating their behavior

#### Scenario: agent handlers bind through CommandDeps
- **WHEN** the agent dispatcher is constructed
- **THEN** its dependencies bind the shared library functions so tests can
  inject fakes and the production wiring stays identical to the local paths

### Requirement: Query commands are routed to read-only handlers

The agent SHALL route query commands — `status`, `env.get`, `projects.list`, `providers.list`, `git.config.get`, `glab.instances`, `ssh.key.list` — to their corresponding read-only handlers and answer each with a `result` message (see `center-protocol`). Query handlers SHALL reuse the existing read paths used by the local admin API and SHALL NOT mutate state. Route-local read helpers SHALL be extracted or exported behind a shared read-only interface before agent handlers consume them.

#### Scenario: status query is answered
- **WHEN** a `command` message with payload type `status` is received
- **THEN** the handler assembles the current status fields (container state, versions, auth status)
- **AND** the result payload contains `container_status`, `uptime_seconds`, `containers`, `versions`, `gh_auth`, `glab_auth`, `admin_version`, `admin_version_mismatch`, and `upgrade_state`
- **AND** the agent sends a `result` carrying those fields

#### Scenario: env.get query is answered
- **WHEN** a `command` message with payload type `env.get` is received
- **THEN** the agent sends a `result` carrying the requested environment variables as a key/value map
- **AND** password-typed keys from the existing environment schema are redacted
- **AND** key material is masked or omitted

#### Scenario: projects.list query is answered
- **WHEN** a `command` message with payload type `projects.list` is received
- **THEN** the agent sends a `result` carrying project entries shaped as `{ features: { knowledge, maintenance, openspec }, remote, disabled }`

#### Scenario: providers.list query is answered
- **WHEN** a `command` message with payload type `providers.list` is received
- **THEN** the agent sends a `result` carrying provider metadata including `registry.keys[]`
- **AND** each registry key exposes only its masked value (first 4 + last 4 characters, or redacted for short values)

#### Scenario: git.config.get query is answered
- **WHEN** a `command` message with payload type `git.config.get` is received
- **THEN** the agent sends a `result` carrying the global git config as a key/value map
- **AND** `credential.*` and `url.*` entries are dropped from the result
- **AND** any remaining value matching key-material patterns is masked or omitted

#### Scenario: glab.instances query is answered
- **WHEN** a `command` message with payload type `glab.instances` is received
- **THEN** the agent sends a `result` carrying configured instances shaped as `{ hostname, username, authenticated }`
- **AND** no token value is present in the payload

#### Scenario: ssh.key.list query is answered
- **WHEN** a `command` message with payload type `ssh.key.list` is received
- **THEN** the agent sends a `result` carrying existing keys shaped as `{ name, type, fingerprint }`
- **AND** no private key material or public key content is present in the payload

#### Scenario: Query commands have no side effects
- **WHEN** any query command is executed
- **THEN** no files, environment variables, or container state are modified

### Requirement: Upgrade command runs the existing upgrade pipeline

The `upgrade` command SHALL execute the existing `runUpgrade()` pipeline (pull latest image, backup, merge `.env`, recreate ai-dev, poll health, reconcile registrations, cleanup) and report the outcome.

#### Scenario: Upgrade succeeds
- **WHEN** an `upgrade` command completes successfully
- **THEN** an `ack` message reporting success is sent to the Center Server

#### Scenario: Upgrade fails
- **WHEN** `runUpgrade()` reports failure
- **THEN** an `ack` message reporting the failure is sent to the Center Server

#### Scenario: Upgrade already running
- **WHEN** an `upgrade` command arrives while an upgrade is already in progress
- **THEN** the command is deferred and executed after the running upgrade completes, following the agent-side deferral queue ordering

### Requirement: Reconfigure command updates env and restarts the ai-dev container

The `reconfigure` command SHALL write the supplied key/value pairs to `/opt/ai-engkit/.env` via the existing env library and restart the ai-dev container (`ai-engkit`) via the existing `restartAiDev()` flow, then report the outcome.

#### Scenario: Env values are updated and the ai-dev container restarted
- **WHEN** a `reconfigure` command with an `env` object containing only string values is received
- **THEN** each key is written to `.env`
- **AND** the ai-dev container is restarted (compose recreate in production, plain restart in dev/DooD)
- **AND** an `ack` message reporting success is sent

#### Scenario: Invalid reconfigure payload
- **WHEN** a `reconfigure` command lacks an `env` object or contains non-string values
- **THEN** no change is made to `.env` and an `error` message is sent

### Requirement: Restart command restarts a container

The `restart` command SHALL restart the container named in the command payload. The payload names one of the two compose services, `ai-dev` or `ai-admin`, which the agent resolves to the production containers `ai-engkit` and `ai-engkit-admin` (via the sibling-name convention; a development run resolves to the dev containers instead). When the target is the admin container itself, the `ack` SHALL be sent before the restart executes so the outcome is not lost when the connection drops (response-first pattern).

#### Scenario: Restart the ai-dev container
- **WHEN** a `restart` command targeting `ai-dev` is received
- **THEN** the ai-dev container (`ai-engkit`) is restarted
- **AND** an `ack` message reporting the outcome is sent

#### Scenario: Restart the admin container (self-restart)
- **WHEN** a `restart` command targeting `ai-admin` is received
- **THEN** an `ack` message is sent first, and the admin container (`ai-engkit-admin`) is then restarted (recreate with the latest image, mirroring the existing admin restart endpoint)

#### Scenario: Unknown restart target
- **WHEN** a `restart` command names a target other than `ai-dev` or `ai-admin`
- **THEN** no restart is performed and an `error` message is sent

### Requirement: Commands are queued while execution is blocked

A command that cannot execute immediately — because an upgrade is in progress or the connection drops after receipt — SHALL be held in an in-memory FIFO deferral queue and executed in order once the blocking condition clears (upgrade completes or connection is re-established). The queue SHALL NOT survive an agent process restart.

#### Scenario: Command deferred during upgrade
- **WHEN** a command arrives while an upgrade is running
- **THEN** the command is queued, not executed
- **AND** after the upgrade completes, queued commands execute in FIFO order

#### Scenario: Queued commands survive a brief disconnection
- **WHEN** queued commands exist and the connection drops
- **THEN** the queue is retained
- **AND** after a successful reconnect, the queued commands execute in FIFO order

#### Scenario: Queue is lost on process restart
- **WHEN** the admin process restarts
- **THEN** any in-memory queued commands are discarded

### Requirement: Remote management handlers reuse the shared local admin logic

Remote management handlers SHALL call the shared library functions and route logic the local admin routes use — `secrets` (env write), `ssh-keys`, `git-config`, `gh-auth`, `glab-auth`, and `projects` — and SHALL NOT reimplement route behavior. Where a local route keeps its logic inside the route handler, the logic SHALL be extracted or exported behind a shared function the route and the agent handler both consume. Agent handlers SHALL bind through `CommandDeps` so tests can inject fakes and production wiring stays identical to the local paths.

#### Scenario: shared functions are used
- **WHEN** a remote management command executes
- **THEN** it calls the shared functions rather than duplicating their behavior

#### Scenario: agent handlers bind through CommandDeps
- **WHEN** the agent dispatcher is constructed
- **THEN** its dependencies bind the shared functions so the local routes and remote handlers behave identically

### Requirement: Secret management commands update the env schema password keys

The `secrets.set` command SHALL write one of the environment-schema password keys (`ADMIN_PASSWORD`, `OPENCHAMBER_UI_PASSWORD`, `OPENCODE_SERVER_PASSWORD`) through the same env-file library the local Secrets page uses. A command naming any other key SHALL be rejected with `error` `malformed_command` before any write. The command SHALL NOT perform a restart itself; the ack SHALL report the key's activation status (`immediate` for `ADMIN_PASSWORD`, `restart_required` for the other two) so the center can issue a `restart` when needed. The ack SHALL NOT echo the value.

#### Scenario: set a password key
- **WHEN** a `secrets.set` command carries a schema key and a non-empty string value
- **THEN** the value is written to the env file
- **AND** the ack reports success and the key's activation status

#### Scenario: set rejects an unknown key
- **WHEN** a `secrets.set` command names a key outside the schema password keys
- **THEN** no env change is made and an `error` (`malformed_command`) is sent

#### Scenario: set rejects an empty value
- **WHEN** a `secrets.set` command carries an empty or non-string value
- **THEN** no env change is made and an `error` (`malformed_command`) is sent

#### Scenario: set performs no restart
- **WHEN** a `secrets.set` command completes for a `restart_required` key
- **THEN** no container is restarted by the command itself
- **AND** the ack states the activation status so the center may issue `restart`

### Requirement: SSH key commands manage keys in the ai-dev home

The `ssh.key.add` command SHALL carry `name`, `keyType` (`"ed25519"` or `"rsa"`, defaulting to `"ed25519"`), and an optional `passphrase`, and SHALL generate an SSH key pair in the ai-dev home directory (default name `id_ed25519`) using the same commands the local SSH Keys page runs, and SHALL register the new key with the SSH agent. The `ssh.key.delete` command SHALL carry a `name` and SHALL remove the named key pair from disk and drop it from the SSH agent. The `ssh.key.list` query SHALL return existing keys as `{ name, type, fingerprint }` without private or public key content. A name containing path separators or shell-active characters SHALL be rejected with `error` `malformed_command` before any filesystem change. The ack SHALL report success or the underlying command failure.

#### Scenario: add an ed25519 key
- **WHEN** a `ssh.key.add` command with no `keyType` is received
- **THEN** an ed25519 key pair is generated in the ai-dev home
- **AND** the key is registered with the SSH agent
- **AND** an `ack` reporting success is sent

#### Scenario: add an rsa key
- **WHEN** a `ssh.key.add` command with `keyType: "rsa"` is received
- **THEN** a 4096-bit RSA key pair is generated in the ai-dev home
- **AND** an `ack` reporting success is sent

#### Scenario: add rejects an unsafe key name
- **WHEN** a `ssh.key.add` or `ssh.key.delete` command carries a name with path separators or shell-active characters
- **THEN** no key is created or removed and an `error` (`malformed_command`) is sent

#### Scenario: delete a key
- **WHEN** a `ssh.key.delete` command names an existing key
- **THEN** the key pair is removed from disk and dropped from the SSH agent
- **AND** an `ack` reporting success is sent

#### Scenario: list keys
- **WHEN** a `ssh.key.list` query is answered
- **THEN** the result carries existing keys as `{ name, type, fingerprint }`
- **AND** no key content is present in the payload

### Requirement: Git identity commands read and write the global git config

The `git.config.set` command SHALL set a global git config key/value pair (e.g. `user.name`, `user.email`) using `git config --global`, mirroring the local Git Config page. The `git.config.get` query SHALL return the global git config as a key/value map, dropping `credential.*` and `url.*` entries and masking any remaining value that matches key-material patterns, so the result never exposes credential helpers or embedded tokens. Malformed payloads SHALL be rejected with `error` `malformed_command` before any write.

#### Scenario: set an identity key
- **WHEN** a `git.config.set` command carries a non-empty key and value
- **THEN** the global git config is updated
- **AND** an `ack` reporting success is sent

#### Scenario: set rejects an empty key or value
- **WHEN** a `git.config.set` command lacks a key or value
- **THEN** no config change is made and an `error` (`malformed_command`) is sent

#### Scenario: get returns the config without credential material
- **WHEN** a `git.config.get` query is answered
- **THEN** the result carries the global config as a key/value map
- **AND** `credential.*` and `url.*` entries are absent
- **AND** key-like values are masked or omitted

### Requirement: GitHub auth commands drive the device-code flow

The `gh.auth.start` command SHALL launch the GitHub device-code flow on the agent (`gh auth login --web`) and SHALL answer with an `ack` whose `data` carries the device code and verification URI, so the center can relay them to the operator. Completion SHALL be observable through the existing `status` query (`gh_auth` becomes `authenticated`); the command itself SHALL NOT block on completion. The `gh.auth.logout` command SHALL disconnect GitHub (`gh auth logout`). The device code is a short-lived credential: agent logs SHALL NOT include it, and it appears only in the ack `data`.

#### Scenario: start the device flow
- **WHEN** a `gh.auth.start` command is received
- **THEN** the agent launches the device-code flow in the ai-dev container
- **AND** the final ack carries `data` with the device code and verification URI
- **AND** the command returns without waiting for authentication to complete

#### Scenario: authentication completion is observed via status
- **WHEN** the operator completes the device flow at the verification URI
- **THEN** a subsequent `status` query reports `gh_auth: "authenticated"`

#### Scenario: disconnect GitHub
- **WHEN** a `gh.auth.logout` command is received
- **THEN** the agent runs `gh auth logout`
- **AND** a subsequent `status` query reports `gh_auth: "not authenticated"`

### Requirement: GitLab instance commands manage configured instances

The `glab.instance.add` command SHALL authenticate the agent against a GitLab hostname using the supplied personal access token (`glab auth login --hostname <host> --token <token>`), normalize the hostname (scheme/path stripped), and configure the git credential helper for that host — the same flow the local GitLab Auth page runs. The `glab.instance.remove` command SHALL log out of the named instance and remove its entry from the glab config. The `glab.instances` query SHALL return configured instances as `{ hostname, username, authenticated }`. The token travels in the command payload only and SHALL NOT appear in any ack, result, or log.

#### Scenario: add an instance with a token
- **WHEN** a `glab.instance.add` command carries a hostname and a personal access token
- **THEN** the agent authenticates with glab and configures the git credential helper for the normalized hostname
- **AND** the ack reports success without echoing the token

#### Scenario: add rejects a missing token
- **WHEN** a `glab.instance.add` command lacks a token
- **THEN** no authentication is attempted and an `error` (`malformed_command`) is sent

#### Scenario: remove an instance
- **WHEN** a `glab.instance.remove` command names a configured hostname
- **THEN** the agent logs out of that instance and removes its config entry
- **AND** the ack reports success

#### Scenario: list instances
- **WHEN** a `glab.instances` query is answered
- **THEN** the result carries configured instances as `{ hostname, username, authenticated }`
- **AND** no token value is present

### Requirement: Project management commands mirror the local project routes

The project commands SHALL reproduce the local Projects page behavior through the shared project libraries (`openchamber-projects.ts`, `projects-overview.ts`). `projects.create` SHALL clone a remote or `git init` a new project, write the AI-EngKit `.gitignore` entries, clear any disabled state, and register the project with OpenChamber. `projects.set-remote` SHALL init-if-needed and add/set/remove the `origin` remote, bootstrapping a fresh repo with a shallow fetch and checkout. `projects.enable` SHALL unmark the disabled state and re-register the project; `projects.disable` SHALL mark it disabled and unregister it, rolling back on failure. `projects.enable-feature` SHALL enable one of the whitelisted skill scaffolds (`knowledge`, `maintenance`, `openspec`). `projects.sync` SHALL reconcile workspace directories with OpenChamber registration from `add`/`remove` name arrays. When a `git_remote` is supplied, `git_init` SHALL default to true so the project is cloned rather than created empty; without `git_init` and without a remote, only the project directory is created. Project names SHALL pass the shared name validation; malformed payloads or invalid names SHALL be rejected with `error` `malformed_command` before any filesystem change.

#### Scenario: create a new project from a remote
- **WHEN** a `projects.create` command carries a valid name and a `git_remote`
- **THEN** the project is cloned into the workspace with the AI-EngKit `.gitignore` entries
- **AND** any previous disabled state is cleared
- **AND** the project is registered with OpenChamber
- **AND** an `ack` reporting success is sent

#### Scenario: create a new local project
- **WHEN** a `projects.create` command carries a valid name and `git_init` without a remote
- **THEN** the directory is created and `git init` runs with an initial commit
- **AND** the project is registered with OpenChamber
- **AND** an `ack` reporting success is sent

#### Scenario: create rejects an invalid name
- **WHEN** a `projects.create` command carries a name failing the shared project-name validation
- **THEN** no directory is created and an `error` (`malformed_command`) is sent

#### Scenario: set the git remote
- **WHEN** a `projects.set-remote` command names an existing project and a remote URL
- **THEN** the `origin` remote is added or updated
- **AND** a repo without commits is bootstrapped with a shallow fetch and checkout
- **AND** an `ack` reporting success is sent

#### Scenario: enable a project
- **WHEN** a `projects.enable` command names a disabled project
- **THEN** the disabled state is cleared and the project is registered with OpenChamber
- **AND** an `ack` reporting success is sent

#### Scenario: disable a project
- **WHEN** a `projects.disable` command names an enabled project
- **THEN** the project is marked disabled and unregistered from OpenChamber
- **AND** an `ack` reporting success is sent

#### Scenario: enable a skill feature
- **WHEN** a `projects.enable-feature` command carries a feature from `knowledge`, `maintenance`, or `openspec`
- **THEN** the corresponding skill scaffold is bootstrapped in the project
- **AND** an `ack` reporting success is sent

#### Scenario: enable-feature rejects an unknown feature
- **WHEN** a `projects.enable-feature` command names a feature outside the whitelist
- **THEN** no project change is made and an `error` (`malformed_command`) is sent

#### Scenario: sync projects
- **WHEN** a `projects.sync` command carries `add`/`remove` arrays of valid project names
- **THEN** each named project is added to or removed from OpenChamber registration
- **AND** an `ack` reporting per-project messages is sent
