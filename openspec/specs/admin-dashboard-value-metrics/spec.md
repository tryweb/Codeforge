## Purpose

Adds optional lean-ctx Decision Loop summary metrics to the Admin Dashboard, alongside the dashboard's other operational information, so an administrator can monitor high-level value and savings signals without requiring the dashboard to be a full LeanCTX analytics view.

## Requirements

### Requirement: Dashboard displays Decision Loop summary metrics

The Admin Dashboard SHALL present a "Decision Loop" panel showing high-level value-gate data derived from `lean-ctx value-report --live --format json`: total tasks assessed, acceptance rate, CPAO (cost-per-accepted-outcome) in microseconds, ETPAO (effective tokens-per-accepted-outcome), and estimated USD savings. The panel SHALL remain a summary view and SHALL NOT require per-task details. When the value-report probe fails or returns no data, the panel SHALL render as unavailable without failing the Dashboard page.

#### Scenario: Value report data renders successfully

- **WHEN** the `value-report --live --format json` probe succeeds and returns task data
- **THEN** the Dashboard shows a "Decision Loop" panel with summary metrics (total tasks, acceptance rate, CPAO, ETPAO, and USD savings)

#### Scenario: Value report probe fails

- **WHEN** the value-report probe times out, returns non-JSON, or the command is unavailable
- **THEN** the Decision Loop panel renders as "unavailable" and the Dashboard page still loads successfully

#### Scenario: Value report returns empty data

- **WHEN** the value-report probe succeeds but reports zero tasks assessed
- **THEN** the Decision Loop panel shows "No assessments recorded yet" and the page still loads

### Requirement: Dashboard displays evidence chain summary status

The Admin Dashboard SHALL present an "Evidence Chain" panel showing high-level Decision Loop evidence data derived from `lean-ctx prove --format json`: total task count, overall acceptance rate, evidence chain completeness (boolean), and the ledger item count. The panel SHALL remain a summary view and SHALL NOT require per-task details or full ledger metadata. When the prove probe fails, the panel SHALL render as unavailable without failing the page.

#### Scenario: Prove report data renders successfully

- **WHEN** the `prove --format json` probe succeeds and returns task data
- **THEN** the Dashboard shows an "Evidence Chain" panel with summary metrics (acceptance rate, chain completeness, ledger item count, and task count)

#### Scenario: Prove probe fails

- **WHEN** the prove probe times out, returns non-JSON, or the command is unavailable
- **THEN** the Evidence Chain panel renders as "unavailable" and the page still loads

#### Scenario: Prove returns empty data

- **WHEN** the prove probe succeeds but reports zero tasks
- **THEN** the panel shows "No evidence data" and the page still loads

### Requirement: Dashboard displays a savings-by-tool summary

The Admin Dashboard SHALL present a "Savings by Tool" panel showing a ranked list of top tools by tokens saved, derived from `lean-ctx savings --format json`. The existing Token Savings card (derived from `gain --json`) SHALL remain unchanged. When the savings-report probe fails, the panel SHALL render as unavailable without failing the page.

#### Scenario: Savings report data renders successfully

- **WHEN** the `savings --format json` probe succeeds and returns data
- **THEN** the Dashboard shows a "Savings by Tool" panel with a ranked tool breakdown table

#### Scenario: Savings report probe fails

- **WHEN** the savings-report probe times out, returns non-JSON, or the command is unavailable
- **THEN** the Savings by Tool panel renders as "unavailable" and the page still loads

### Requirement: New metrics are surfaced through /api/status

The `/api/status` endpoint SHALL include `valueReport`, `proveReport`, and `savingsReport` fields in the response body, each containing the parsed JSON output of the corresponding probe or `null` when the probe fails. The fields SHALL be gathered in parallel with existing probes and SHALL NOT block or delay the status response.

#### Scenario: Status endpoint includes new fields

- **WHEN** a client requests `GET /api/status`
- **THEN** the response includes `valueReport`, `proveReport`, and `savingsReport` fields, each either a parsed JSON object or `null`

#### Scenario: New probe failure does not block status response

- **WHEN** one of the new probes times out
- **THEN** the corresponding field is `null` and the status response still succeeds with all other fields populated

### Requirement: New probes are bounded and cached

The system SHALL run the three new probes (value-report, prove, savings-report) with a timeout matching the existing probe timeout (10 seconds default). Each probe SHALL be cached with a TTL matching the existing cache TTL (300 seconds default). A probe that exceeds the timeout SHALL yield `null` for its field and SHALL NOT block other probes or the page response.

#### Scenario: Cached probe returns within TTL

- **WHEN** a Dashboard page load occurs within the cache TTL of a previous successful probe
- **THEN** the cached result is used without re-running the CLI command

#### Scenario: Timeout yields null and page still loads

- **WHEN** a new probe exceeds the 10-second timeout
- **THEN** the corresponding Dashboard field is null/unavailable and the page renders successfully
