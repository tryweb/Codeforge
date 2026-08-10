## Purpose

Defines command dispatch on the ai-admin agent: parsing and routing of `command` messages from the Center Server to the `upgrade`, `reconfigure`, and `restart` handlers, and the in-memory FIFO deferral queue that holds commands blocked by an in-progress upgrade or a dropped connection.

## Requirements

> **Container naming.** The agent module operates in the production environment only. Compose services `ai-dev` and `ai-admin` correspond to the production containers `ai-engkit` and `ai-engkit-admin`. The test/dev containers (`ai-engkit-dev`, `ai-engkit-admin-dev`) are used only while developing or testing the module itself; the existing sibling-name convention (`getSiblingDevContainerName`) derives the correct container from the admin container's own name, so a development run targets the dev containers and never production.

### Requirement: Commands are parsed and routed to handlers

The agent SHALL accept `command` messages from the Center Server and route each to the handler named by the `type` field in the command payload. Supported command types are `upgrade`, `reconfigure`, and `restart`.

#### Scenario: Known command is routed
- **WHEN** a `command` message whose payload type is one of `upgrade`, `reconfigure`, or `restart` is received
- **THEN** the corresponding handler is invoked with the command payload

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
- **WHEN** a `reconfigure` command with an `updates` object is received
- **THEN** each key is written to `.env`
- **AND** the ai-dev container is restarted (compose recreate in production, plain restart in dev/DooD)
- **AND** an `ack` message reporting success is sent

#### Scenario: Invalid reconfigure payload
- **WHEN** a `reconfigure` command lacks an `updates` object or contains non-string values
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