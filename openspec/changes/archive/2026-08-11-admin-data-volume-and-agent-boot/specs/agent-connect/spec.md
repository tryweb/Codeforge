## MODIFIED Requirements

### Requirement: Agent connects outbound to Center Server when configured

The ai-admin process SHALL act as an agent that opens an outbound WebSocket connection to the Center Server endpoint configured by `CENTER_URL`. The agent SHALL resolve `CENTER_URL` from the admin env file (`/opt/ai-engkit/.env`) at startup, falling back to the process environment, so the configuration takes effect immediately after any container restart. The agent SHALL open no inbound network ports and SHALL be disabled when `CENTER_URL` is unset.

#### Scenario: CENTER_URL is unset
- **WHEN** the admin server starts and `CENTER_URL` is not set or is empty in both the env file and the process environment
- **THEN** the agent module is disabled and no connection attempt is made
- **AND** a log line records that agent mode is disabled

#### Scenario: CENTER_URL is set in the env file
- **WHEN** the admin server starts and `CENTER_URL` is set to a `ws://` or `wss://` endpoint in `/opt/ai-engkit/.env`
- **THEN** the agent opens a WebSocket connection to that endpoint after the HTTP server has started
- **AND** no inbound port is opened on the host

#### Scenario: CENTER_URL is set
- **WHEN** the admin server starts and `CENTER_URL` is set to a `ws://` or `wss://` endpoint in the process environment
- **THEN** the agent opens a WebSocket connection to that endpoint after the HTTP server has started
- **AND** no inbound port is opened on the host
