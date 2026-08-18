## Purpose

Surfaces lean-ctx Decision Loop metrics — task value assessments, evidence chain audits, and savings breakdowns by tool — through the Admin Dashboard, so an administrator can monitor whether the system is making good decisions and where context-engineering value is concentrated.

## Requirements

### Requirement: Dashboard displays Decision Loop value metrics

The Admin Dashboard SHALL present a "Decision Loop" panel showing aggregate value-gate data derived from `lean-ctx value-report --live --format json`: total tasks assessed, acceptance rate (percentage of tasks accepted by the value gate), CPAO (cost-per-accepted-outcome) in microseconds, ETPAO (effective tokens-per-accepted-outcome), total cost in microseconds, and estimated USD savings. The panel SHALL also include a per-task breakdown table showing each task's model, total tokens, cost, acceptance status, and evidence strings. When the value-report probe fails or returns no data, the panel SHALL render as unavailable without failing the Dashboard page.

#### Scenario: Value report data renders successfully

- **WHEN** the `value-report --live --format json` probe succeeds and returns task data
- **THEN** the Dashboard shows a "Decision Loop" panel with aggregate metrics (total tasks, acceptance rate, CPAO, ETPAO, cost, USD savings) and a per-task breakdown table

#### Scenario: Value report probe fails

- **WHEN** the value-report probe times out, returns non-JSON, or the command is unavailable
- **THEN** the Decision Loop panel renders as "unavailable" and the Dashboard page still loads successfully

#### Scenario: Value report returns empty data

- **WHEN** the value-report probe succeeds but reports zero tasks assessed
- **THEN** the Decision Loop panel shows "No assessments recorded yet" and the page still loads

### Requirement: Dashboard displays evidence chain status

The Admin Dashboard SHALL present an "Evidence Chain" panel showing Decision Loop evidence data derived from `lean-ctx prove --format json`: overall acceptance rate, aggregate CPAO, evidence chain completeness (boolean), ledger metadata (created_at, updated_at, schema_version, item count), and total task count. The panel SHALL also include a per-task summary showing each task's query, profile intent, profile complexity, envelope status, reference count, receipt source count, cost, acceptance status, and evidence stages. When the prove probe fails, the panel SHALL render as unavailable without failing the page.

#### Scenario: Prove report data renders successfully

- **WHEN** the `prove --format json` probe succeeds and returns task data
- **THEN** the Dashboard shows an "Evidence Chain" panel with aggregate metrics (acceptance rate, CPAO, chain completeness, ledger info, task count) and a per-task summary table

#### Scenario: Prove probe fails

- **WHEN** the prove probe times out, returns non-JSON, or the command is unavailable
- **THEN** the Evidence Chain panel renders as "unavailable" and the page still loads

#### Scenario: Prove returns empty data

- **WHEN** the prove probe succeeds but reports zero tasks
- **THEN** the panel shows "No evidence data" and the page still loads

### Requirement: Dashboard displays savings breakdown by tool

The Admin Dashboard SHALL present a "Savings by Tool" panel showing savings data derived from `lean-ctx savings --format json`: period (default "week"), total tasks, accepted tasks, tokens processed, tokens saved, compression percentage, estimated USD, actual USD, total savings USD, savings percentage, CPAO USD, ETPAO, and a ranked list of the top tools by tokens saved. The existing Token Savings card (derived from `gain --json`) SHALL remain unchanged. When the savings-report probe fails, the panel SHALL render as unavailable without failing the page.

#### Scenario: Savings report data renders successfully

- **WHEN** the `savings --format json` probe succeeds and returns data
- **THEN** the Dashboard shows a "Savings by Tool" panel with period-scoped aggregates and a ranked tool breakdown table

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
