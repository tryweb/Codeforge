## MODIFIED Requirements

### Requirement: Dashboard includes site-level leanCTX statistics

The Admin Dashboard SHALL present leanCTX statistics aggregated across all projects with leanCTX state: the number of projects with stored memory facts, the total number of memory facts across all projects, the number of projects with recorded agent activity within the last 24 hours, and the number of projects with a cached health score. The statistics SHALL be derived from the same leanCTX state files under the ai-dev container, aggregated across every knowledge directory in one scan. The statistics SHALL NOT include any per-project breakdown or any live session activity, which is not reliably attributable per project. When the scan fails, the Dashboard SHALL render the statistics as unavailable without failing the page. In addition to the existing memory-fact and activity metrics, the Dashboard SHALL also surface Decision Loop value metrics (from `lean-ctx value-report`), evidence chain metrics (from `lean-ctx prove`), and savings-by-tool breakdowns (from `lean-ctx savings`) as separate panels. These new panels are additive and SHALL NOT replace or alter the existing leanCTX memory and activity panels.

#### Scenario: Dashboard shows aggregated leanCTX statistics

- **WHEN** the site scan succeeds
- **THEN** the Dashboard shows the number of projects with memory facts, the total memory fact count, the number of projects active within 24 hours, and the health coverage count

#### Scenario: Dashboard shows Decision Loop and evidence chain panels

- **WHEN** the value-report and prove probes succeed
- **THEN** the Dashboard shows a "Decision Loop" panel with acceptance rate and CPAO, and an "Evidence Chain" panel with chain completeness and ledger metadata, alongside the existing leanCTX panels

#### Scenario: Scan failure renders statistics unavailable

- **WHEN** the leanCTX site scan fails (timeout or read failure)
- **THEN** the Dashboard renders the leanCTX statistics as unavailable and the page still loads
