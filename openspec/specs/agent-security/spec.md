## Purpose

Defines the security properties of the ai-admin agent connection: optional mutual TLS authentication with connect-time certificate reads, pre-shared token authentication as fallback, and validation of every incoming command before execution.

## Requirements

### Requirement: TLS mutual authentication is optional and configurable

When `CENTER_CA_CERT`, `CENTER_CLIENT_CERT`, and `CENTER_CLIENT_KEY` are set to paths of mounted files, the agent SHALL validate the Center Server's certificate against the configured CA and present the client certificate during the WebSocket handshake. The certificate files SHALL be read at connect time, not at process startup, so rotation does not require an agent restart.

#### Scenario: mTLS configured
- **WHEN** all three certificate env vars are set and point to existing files
- **THEN** the agent connects using mutual TLS: it presents the client certificate and requires the Center Server certificate to chain to the configured CA

#### Scenario: mTLS not configured
- **WHEN** none of the certificate env vars are set
- **THEN** the agent connects without a client certificate

#### Scenario: Partial mTLS configuration
- **WHEN** only some of the three certificate env vars are set
- **THEN** mTLS is treated as not configured and a warning is logged

#### Scenario: Center certificate fails CA validation
- **WHEN** the Center Server presents a certificate that does not chain to the configured CA
- **THEN** the connection is refused and the agent retries with the reconnect backoff

#### Scenario: Certificate rotation without restart
- **WHEN** a certificate file is replaced while the agent is running
- **THEN** the next connection attempt reads the new file, without restarting the agent

### Requirement: Pre-shared token authentication

The agent SHALL present the registration token during connection establishment so the Center Server can authenticate and register the agent. The token SHALL be read from the `CENTER_URL` (embedded, e.g., a `?token=` query parameter) or, when not embedded, from the `CENTER_TOKEN` environment variable. Token auth is the fallback for deployments that do not use mTLS.

#### Scenario: Token embedded in the Center URL
- **WHEN** `CENTER_URL` embeds the token and mTLS is not configured
- **THEN** the agent extracts the token and presents it during the WebSocket handshake

#### Scenario: Token from CENTER_TOKEN
- **WHEN** `CENTER_URL` does not embed a token and `CENTER_TOKEN` is set
- **THEN** the agent presents the `CENTER_TOKEN` value during the WebSocket handshake

#### Scenario: No token configured
- **WHEN** neither the URL nor `CENTER_TOKEN` provides a token
- **THEN** the agent connects without a token, and registration fails unless the Center Server accepts anonymous connections

#### Scenario: Center rejects the token
- **WHEN** the Center Server rejects the connection because the token is missing or invalid
- **THEN** the agent records the failure and retries with the reconnect backoff

### Requirement: Command validation

The agent SHALL validate every incoming command before execution: the envelope and command payload SHALL be structurally valid and the command type SHALL be supported. Invalid commands SHALL be rejected with an `error` message and SHALL NOT execute.

#### Scenario: Malformed command payload rejected
- **WHEN** a command message arrives with a missing or malformed payload (e.g., non-object, missing type field)
- **THEN** an `error` message is sent and no command executes

#### Scenario: Unknown command type rejected
- **WHEN** a command message arrives with an unsupported type
- **THEN** an `error` message is sent and no command executes