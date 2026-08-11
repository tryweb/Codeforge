## Purpose

Defines the outbound WebSocket connection behavior of the ai-admin agent: connection to the Center Server endpoint configured by `CENTER_URL`, exponential-backoff reconnection, connection lifecycle logging, the JSON message envelope, and local agent-status reporting.

## Requirements

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

### Requirement: Reconnect with exponential backoff and jitter

When the WebSocket connection is lost, the agent SHALL reconnect with exponential backoff — 1s, 2s, 4s, doubling per attempt — capped at 300s, with ±25% random jitter applied to every wait.

#### Scenario: Disconnect triggers reconnect
- **WHEN** the connection drops (network failure, Center Server restart, idle timeout)
- **THEN** the agent waits 1s (±25% jitter) and attempts to reconnect
- **AND** each successive failed attempt doubles the wait (2s, 4s, 8s, ...)

#### Scenario: Backoff is capped
- **WHEN** the doubling reaches the maximum wait
- **THEN** subsequent waits stay at 300s (±25% jitter) and never exceed it

#### Scenario: Backoff resets after a successful reconnect
- **WHEN** a reconnect attempt succeeds
- **THEN** the backoff counter resets so the next disconnect starts again at 1s

### Requirement: Connection lifecycle is logged

The agent SHALL log connect, disconnect, and reconnect events so that connection behavior is observable from the admin logs.

#### Scenario: Connection events are recorded
- **WHEN** the agent connects, disconnects, or reconnects
- **THEN** a log entry describing the event and its timestamp is written

### Requirement: Messages use a JSON envelope

All messages between the agent and the Center Server SHALL use the JSON envelope `{ type, payload, id, timestamp }`, where `type` is one of the message types defined by the `center-protocol` Message catalog, `id` is a unique message identifier, and `timestamp` is an ISO 8601 timestamp.

#### Scenario: Outgoing messages are enveloped
- **WHEN** the agent sends any message
- **THEN** the message carries a `type`, a unique `id`, and an ISO `timestamp`

#### Scenario: Incoming messages are parsed as envelopes
- **WHEN** a message arrives that is not a valid JSON envelope
- **THEN** the message is ignored and an `error` message is sent to the Center Server

### Requirement: Agent status is exposed in the local API

The existing `/api/status` response SHALL include the agent's connection state (`connected`, `disconnected`, or `disabled`) so local operators can observe agent health.

#### Scenario: Agent status reported locally
- **WHEN** `/api/status` is requested
- **THEN** the response includes an `agent_status` field reflecting the current connection state
