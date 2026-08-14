## Purpose

Defines the periodic heartbeat behavior of the ai-admin agent: a 60-second status report sent to the Center Server while connected, whose payload is shared with the local dashboard, and handling of Center Server heartbeat acknowledgements.

## Requirements

### Requirement: Heartbeat sent every 60 seconds

While connected, the agent SHALL send a `heartbeat` message every 60 seconds carrying a status report.

#### Scenario: Periodic heartbeat while connected
- **WHEN** the agent has an open connection to the Center Server
- **THEN** a heartbeat message is sent every 60 seconds
- **AND** each heartbeat carries a unique id and an ISO timestamp

#### Scenario: No heartbeat while disconnected
- **WHEN** the connection is closed
- **THEN** no heartbeat is sent until the connection is re-established

### Requirement: Heartbeat carries a status report

Each heartbeat SHALL carry a status report with the fields `container_status`, `uptime_seconds`, `containers`, `versions`, `gh_auth`, `glab_auth`, `admin_version`, `admin_version_mismatch`, and `upgrade_state`.

#### Scenario: Status fields are populated
- **WHEN** a heartbeat is sent
- **THEN** the payload contains `container_status` (`running` or `stopped`) and `uptime_seconds` for the ai-dev container (`ai-engkit`)
- **AND** `containers` maps each container of the AI-EngKit instance — `ai-dev` (development container, `ai-engkit`/`ai-engkit-dev`) and `ai-admin` (admin container, `ai-engkit-admin`/`ai-engkit-admin-dev`, where the agent itself runs) — to its `status` (`running` or `stopped`), `uptime_seconds` (`null` when unavailable), and `version` (from `/opt/ai-engkit/VERSION` in that container)
- **AND** `versions` maps component names (AI-EngKit, OpenCode, OpenChamber, Docker) to their versions
- **AND** `gh_auth` and `glab_auth` are `authenticated` or `not authenticated`
- **AND** `admin_version` is the version from `/opt/ai-engkit/VERSION`
- **AND** `admin_version_mismatch` reflects whether the admin and ai-dev image digests differ
- **AND** `upgrade_state` is the current upgrade state (`idle`, `running`, `completed`, or `failed`)

#### Scenario: Legacy scalar fields match the ai-dev container
- **WHEN** a heartbeat status report is sent
- **THEN** `container_status` equals `containers["ai-dev"].status`
- **AND** `uptime_seconds` equals `containers["ai-dev"].uptime_seconds`
- **AND** the scalar fields are kept so that Center Servers not yet aware of `containers` can still display the ai-dev container

#### Scenario: Status gathering is shared with the local API
- **WHEN** a heartbeat status report is built
- **THEN** it is assembled by the same status-gathering functions used by the local dashboard and `/api/status`, not by a separate duplicate implementation

### Requirement: Heartbeat acknowledgements are handled

The agent SHALL recognize `ack` messages from the Center Server and correlate them to the heartbeat ids it sent.

#### Scenario: Ack received for a heartbeat
- **WHEN** an `ack` message referencing a previously sent heartbeat id arrives
- **THEN** the agent records the acknowledged heartbeat id and logs it