## Purpose

Surfaces per-project codegraph index health through the Admin projects overview API and UI, and site-level leanCTX statistics through the Admin Dashboard, so an admin can see at a glance whether a workspace project is indexed for code intelligence and how leanCTX context is used across the workspace.

## ADDED Requirements

### Requirement: Projects overview includes codegraph index status
The system SHALL include, for every project in the `GET /api/projects/overview` response, a `codegraph` field reporting the index state of `<project>/.codegraph` inside the ai-dev workspace: whether the project is indexed, file/node/edge counts, the last index timestamp, pending changes (added/modified/removed since the index), whether a re-index is recommended, and the index state when known. A project directory without a codegraph index SHALL be reported as not initialized rather than as an error. When the status probe fails (timeout, missing codegraph CLI, or malformed output), the field SHALL be `null` and the response SHALL still succeed.

#### Scenario: Indexed project reports full status
- **WHEN** a project has a valid `.codegraph` index
- **THEN** the overview response includes `codegraph.initialized: true` with file/node/edge counts, `lastIndexed`, `pendingChanges`, `reindexRecommended`, and `state`

#### Scenario: Never-indexed project reports not initialized
- **WHEN** a project directory exists but has no codegraph index
- **THEN** the response includes `codegraph.initialized: false` and no counts, without any error indication

#### Scenario: Probe failure does not fail the overview
- **WHEN** the codegraph status probe for a project times out or returns malformed output
- **THEN** the response includes `codegraph: null` for that project and the overview request still succeeds

### Requirement: Tool status is presented per project in the Admin projects UI
The Admin projects table SHALL render a CodeGraph column for every project. An indexed project SHALL show a positive badge; a not-indexed project SHALL show a distinct neutral badge (not an error); a failed probe SHALL render as an unknown placeholder. Additional detail — last index time, file/node counts, pending changes, and re-index recommendation — SHALL be available in a tooltip or equivalent affordance without leaving the page. No leanCTX column SHALL be rendered: leanCTX is a site-level signal and is surfaced on the Dashboard instead.

#### Scenario: Indexed project shows positive badge with detail
- **WHEN** a project is reported indexed with pending changes of zero
- **THEN** the CodeGraph cell shows a positive badge, and its tooltip shows the last index time, counts, and re-index recommendation

#### Scenario: Not-indexed project shows neutral badge
- **WHEN** a project is reported as not initialized
- **THEN** the CodeGraph cell shows a neutral "not indexed" badge, and no error styling

#### Scenario: Unknown probe renders placeholder
- **WHEN** a project's codegraph field is `null`
- **THEN** the corresponding cell renders an unknown placeholder without failing or blocking the projects page

### Requirement: Dashboard includes site-level leanCTX statistics
The Admin Dashboard SHALL present leanCTX statistics aggregated across all projects with leanCTX state: the number of projects with stored memory facts, the total number of memory facts across all projects, the number of projects with recorded agent activity within the last 24 hours, and the number of projects with a cached health score. The statistics SHALL be derived from the same leanCTX state files under the ai-dev container, aggregated across every knowledge directory in one scan. The statistics SHALL NOT include any per-project breakdown or any live session activity, which is not reliably attributable per project. When the scan fails, the Dashboard SHALL render the statistics as unavailable without failing the page.

#### Scenario: Dashboard shows aggregated leanCTX statistics
- **WHEN** the site scan succeeds
- **THEN** the Dashboard shows the number of projects with memory facts, the total memory fact count, the number of projects active within 24 hours, and the health coverage count

#### Scenario: Scan failure renders statistics unavailable
- **WHEN** the leanCTX site scan fails (timeout or read failure)
- **THEN** the Dashboard renders the leanCTX statistics as unavailable and the page still loads

### Requirement: Status probes are bounded and cached
The system SHALL run status probes with a timeout and SHALL cache results with a time-to-live so repeated requests within the TTL do not re-probe. A probe that exceeds the timeout SHALL yield an unavailable result for the affected scope (a project's `codegraph` field, or the site-level leanCTX statistics) and SHALL NOT block the rest of the response. The codegraph probe cache SHALL be invalidated by project sync so newly added projects are probed on their first overview request.

#### Scenario: Overview within TTL uses cache
- **WHEN** an overview request repeats within the probe cache TTL
- **THEN** the response is served from the cache without re-running status probes

#### Scenario: Timeout yields unavailable result and page still loads
- **WHEN** a probe exceeds the timeout
- **THEN** the affected project is reported as `null`/unknown (or the Dashboard leanCTX statistics as unavailable), and the response still succeeds
