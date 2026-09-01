## Purpose

Defines a compact, status-first Admin Dashboard overview that exposes effective LeanCTX configuration, Center connectivity, provider readiness, and SubAgent model health without duplicating the dedicated management pages or exposing secrets.

## Requirements

### Requirement: Dashboard presents a stable information hierarchy
The Dashboard SHALL render its primary sections in this order: site summary, LeanCTX KPI row, LeanCTX Runtime Profile, one operational row containing Container Status, Projects, and AI Runtime, LeanCTX Insights, then the existing lower-priority administrative sections. The ordering SHALL remain stable when a status changes so warnings do not move controls or links unexpectedly.

#### Scenario: All overview data is available
- **WHEN** the Dashboard loads with all status sources available
- **THEN** the sections appear in the required order

#### Scenario: One overview source is unavailable
- **WHEN** one status source fails
- **THEN** its section renders the specified unavailable state without changing the order of the remaining sections

### Requirement: Semantic tones use the existing design tokens
Every overview status SHALL combine visible text with one of four semantic tones: `success` uses the existing green success token, `warning` uses the existing amber warning token, `danger` uses the existing red danger token, and `neutral` uses the muted text and neutral surface tokens. Color SHALL NOT be the only indication of state.

#### Scenario: A warning is rendered
- **WHEN** any overview field resolves to a warning state
- **THEN** it displays warning text and the amber warning tone rather than relying on color alone

### Requirement: Dashboard copy uses deterministic number formatting
All Dashboard copy defined by this capability SHALL use the `en-US` locale. Integer counts and token values SHALL use grouping separators with no decimal places; percentages SHALL use one decimal place followed by `%`; USD values SHALL use `$` and exactly two decimal places; CPAO SHALL use a grouped integer followed by `μs`; and ETPAO SHALL use a grouped integer followed by ` tokens`. State labels and field labels SHALL use the exact capitalization written in this specification.

#### Scenario: Large numeric values render
- **WHEN** a summary contains 2125 ETPAO tokens, 14000 CPAO microseconds, 80 percent acceptance, and 4.4 USD
- **THEN** it displays `2,125 tokens`, `14,000μs`, `80.0%`, and `$4.40`

### Requirement: Dashboard displays a read-only LeanCTX Runtime Profile
The Dashboard SHALL display a compact `LeanCTX Runtime` profile directly below the KPI row. Its fixed field order SHALL be apply state, `Compression`, `Tools`, `Security`, `Archive`, and an `Open configuration` link to `/leanctx`. The profile SHALL expose no editable controls.

#### Scenario: Confirmed applied profile is available
- **WHEN** a confirmed applied LeanCTX profile is available
- **THEN** the profile shows `Applied` with success tone followed by the effective Compression, Tools, Security, and Archive values

#### Scenario: Saved configuration differs from the applied snapshot
- **WHEN** the saved configuration fingerprint differs from the last confirmed applied snapshot
- **THEN** the first status displays `Pending apply` with warning tone and the profile values continue to describe the last confirmed applied snapshot

#### Scenario: Only saved configuration is available
- **WHEN** no confirmed applied snapshot exists but saved configuration can be read
- **THEN** the first status displays `Saved config only` with neutral tone and the remaining values describe the saved configuration

#### Scenario: Runtime profile cannot be read
- **WHEN** neither an applied snapshot nor saved configuration can be read
- **THEN** the component displays `Runtime profile unavailable` with danger tone and only the `/leanctx` link

### Requirement: Runtime Profile values use deterministic copy
Compression SHALL display `Off`, `Lite`, `Standard`, `Max`, or `Unknown`. Tools SHALL display `Minimal`, `Standard`, `Power`, or `Unknown`. Archive SHALL display `On · {hours}h` when enabled with a positive finite retention value rounded to a whole hour, `Off` when disabled, or `Unknown` when enabled without a valid retention value. Unknown values SHALL use neutral tone; ordinary profile values SHALL not imply success or failure solely from the selected mode.

#### Scenario: Archive is enabled with retention
- **WHEN** the effective archive configuration is enabled with `max_age_hours` equal to 48
- **THEN** the Archive value displays `On · 48h`

#### Scenario: A profile enum is unsupported
- **WHEN** an effective profile value is absent or outside the supported schema
- **THEN** that field displays `Unknown` with neutral tone

#### Scenario: Archive is disabled
- **WHEN** effective archive configuration is disabled
- **THEN** Archive displays `Off` with neutral tone

#### Scenario: Archive retention is unavailable
- **WHEN** effective archive configuration is enabled but retention is absent, non-finite, or not positive
- **THEN** Archive displays `Unknown` with neutral tone

### Requirement: Security posture is derived conservatively
Security SHALL first display `Unknown` with neutral tone when any of `secretDetectionEnabled`, `secretRedactionEnabled`, or `crossProjectSearch` is unavailable. Otherwise it SHALL display `At risk` with danger tone when secret detection or secret redaction is not enabled; otherwise it SHALL display `Review` with warning tone when cross-project search is enabled; otherwise it SHALL display `Protected` with success tone. Permission inheritance does not participate in posture derivation. Accessible detail SHALL list Secret detection, Secret redaction, Cross-project search, and Permission inheritance as `On`, `Off`, or `Unknown` without exposing configuration file contents.

#### Scenario: Secret redaction is disabled
- **WHEN** secret detection is enabled but secret redaction is disabled
- **THEN** Security displays `At risk` with danger tone

#### Scenario: Cross-project search is enabled
- **WHEN** secret detection and redaction are enabled and cross-project search is enabled
- **THEN** Security displays `Review` with warning tone

#### Scenario: Security boundaries are protected
- **WHEN** secret detection and redaction are enabled and cross-project search is disabled
- **THEN** Security displays `Protected` with success tone

#### Scenario: A required security input is unavailable
- **WHEN** secret detection, secret redaction, or cross-project search is unavailable
- **THEN** Security displays `Unknown` with neutral tone regardless of the other values

### Requirement: Site summary displays Center connection state
The site summary SHALL include a `Center` item linked to `/agent`. Runtime state `connected` SHALL display `Connected` with success tone, `disabled` SHALL display `Standalone` with neutral tone, `disconnected` SHALL display `Disconnected` with warning tone, and an unavailable status source SHALL display `Unavailable` with danger tone. No Center URL, token, Agent ID, certificate path, or unredacted error SHALL appear on the Dashboard.

#### Scenario: Center is intentionally not configured
- **WHEN** the Center runtime state is `disabled`
- **THEN** the site summary displays `Center Standalone` with neutral tone

#### Scenario: Configured Center loses connection
- **WHEN** the Center runtime state is `disconnected`
- **THEN** the site summary displays `Center Disconnected` with warning tone and links to `/agent`

#### Scenario: Center is connected
- **WHEN** the Center runtime state is `connected`
- **THEN** the site summary displays `Center Connected` with success tone and links to `/agent`

#### Scenario: Center status is unavailable
- **WHEN** the Center status source is unavailable
- **THEN** the site summary displays `Center Unavailable` with danger tone and links to `/agent`

### Requirement: Dashboard displays a compact AI Runtime summary
The Dashboard SHALL display one `AI Runtime` card with fixed rows ordered `Providers` then `Subagents`. Each row SHALL be independently linked to its management page: Providers to `/providers` and Subagents to `/agent-models`. The card SHALL contain aggregate status only and SHALL NOT list provider accounts, keys, model references, or individual agents.

#### Scenario: AI Runtime data is available
- **WHEN** provider and SubAgent summaries are available
- **THEN** the card shows Providers first and Subagents second with their aggregate copy and row-level links

### Requirement: Provider summary uses readiness rather than credential inventory
The Providers row SHALL summarize effective readiness. A key-managed provider is ready only when OAuth is connected or its effective auth-store key is present; a non-key-managed provider is ready when its configured credential path is present. A selected registry credential without the corresponding effective auth-store key is pending activation, and a configured provider without any effective credential path needs credentials. Aggregate precedence SHALL be invalid, pending activation, needs credentials, ready, none, then unavailable. Only the highest-precedence applicable copy SHALL be shown. One ready provider SHALL display `1 provider ready`; multiple SHALL display `{count} providers ready`. Needs-credentials copy SHALL display `{ready} ready · 1 needs credentials` or `{ready} ready · {count} need credentials`, including `0 ready` when none are ready. Pending activation SHALL display `1 pending activation` or `{count} pending activation`. Invalid provider configuration SHALL display `Provider configuration invalid` with danger tone. An unavailable source SHALL display `Status unavailable` with neutral tone, and zero configured providers SHALL display `No providers configured` with warning tone.

#### Scenario: Every configured provider is ready
- **WHEN** every configured provider has an effective OAuth or credential path
- **THEN** the row displays the ready count with success tone

#### Scenario: Registry selection is not active
- **WHEN** a registry key is selected but the effective auth store does not contain the selected credential
- **THEN** the row displays the pending activation count with warning tone

#### Scenario: Provider metadata is invalid
- **WHEN** provider configuration cannot be parsed or validated
- **THEN** the row displays `Provider configuration invalid` with danger tone

#### Scenario: One provider needs credentials
- **WHEN** two providers are ready and one configured provider has no effective credential path
- **THEN** the row displays `2 ready · 1 needs credentials` with warning tone

#### Scenario: Multiple providers need credentials and none are ready
- **WHEN** no provider is ready and two configured providers have no effective credential path
- **THEN** the row displays `0 ready · 2 need credentials` with warning tone

#### Scenario: No providers are configured
- **WHEN** the provider source succeeds with zero configured providers
- **THEN** the row displays `No providers configured` with warning tone

#### Scenario: Provider status is unavailable
- **WHEN** the provider source fails or times out
- **THEN** the row displays `Status unavailable` with neutral tone

#### Scenario: Pending activation and missing credentials coexist
- **WHEN** at least one provider is pending activation and another needs credentials
- **THEN** the row displays only the pending activation count with warning tone

### Requirement: SubAgent summary uses worst-state-first copy
The Subagents row SHALL aggregate configured Agent Model effectiveness using this severity order: `invalid`, `runtime_mismatch`, `unverified`, `awaiting_request`, then `effective`. Plugin-only rows SHALL not enter the configured denominator. It SHALL display only the highest-severity non-zero condition. All effective SHALL display `{effective}/{configured} effective` with success tone. Invalid SHALL display `1 invalid configuration` or `{count} invalid configurations` with danger tone. Runtime mismatch SHALL display `1 runtime mismatch` or `{count} runtime mismatches` with danger tone. Unverified SHALL display `{count} unverified` with warning tone. Awaiting request SHALL always use the user-facing term `{configured} configured · {count} awaiting verification` with neutral tone. Zero configured SubAgents SHALL display `No SubAgents configured` with neutral tone.

#### Scenario: All configured SubAgents are effective
- **WHEN** all 9 configured SubAgents are effective
- **THEN** the row displays `9/9 effective` with success tone

#### Scenario: Some configured SubAgents await requests
- **WHEN** 9 are configured and 6 have `awaiting_request` as the worst non-zero state
- **THEN** the row displays `9 configured · 6 awaiting verification` with neutral tone

#### Scenario: Runtime mismatch exists
- **WHEN** one or more configured SubAgents have `runtime_mismatch`
- **THEN** the row displays `1 runtime mismatch` or `{count} runtime mismatches` with danger tone regardless of lower-severity counts

#### Scenario: Agent Model source is unavailable
- **WHEN** the live catalog or required runtime status cannot be obtained
- **THEN** the row displays `Status unavailable` with neutral tone

#### Scenario: Invalid configuration exists
- **WHEN** two configured SubAgents are invalid and lower-severity states also exist
- **THEN** the row displays `2 invalid configurations` with danger tone

#### Scenario: Unverified assignments are the worst state
- **WHEN** three configured SubAgents are unverified and no invalid or runtime mismatch exists
- **THEN** the row displays `3 unverified` with warning tone

#### Scenario: No SubAgents are configured
- **WHEN** there are no configured SubAgents and any discovered rows are plugin-only
- **THEN** the row displays `No SubAgents configured` with neutral tone

### Requirement: Dashboard navigation links target dedicated management pages
The Dashboard SHALL make both visible Projects surfaces independently link to `/projects`. The site-summary GitHub, GitLab, and Git items SHALL link to `/auth/github`, `/auth/gitlab`, and `/git-config` respectively, including when Git displays `not configured`. The AI-EngKit version in Component Versions SHALL link to `/versions`; other component version rows MAY remain plain text. Each link SHALL preserve its visible label and state text, expose a useful accessible name, and SHALL NOT contain another interactive element.

#### Scenario: Dashboard management links render
- **WHEN** the Dashboard renders its site summary and Component Versions
- **THEN** Projects has two Dashboard-owned links to `/projects`, GitHub links to `/auth/github`, GitLab links to `/auth/gitlab`, Git links to `/git-config`, and the AI-EngKit version links to `/versions`

#### Scenario: Git is not configured
- **WHEN** `git_user` is empty
- **THEN** the visible `Git not configured` item remains linked to `/git-config`

#### Scenario: Existing AI Runtime row navigation remains explicit
- **WHEN** the AI Runtime card renders
- **THEN** it has no header `Manage` or `Review` action, while Providers links to `/providers` and Subagents links to `/agent-models`

### Requirement: Dashboard status projection is secret-free and failure-isolated
Dashboard data SHALL contain only enum states, booleans, counts, retention limits, and derived copy inputs needed by the overview. It MUST NOT contain raw or masked API keys, tokens, account identifiers, credential fingerprints, Center URLs, model-by-model assignments, or full errors. Failure or timeout of any new source SHALL not fail the Dashboard page.

#### Scenario: Provider summary is serialized
- **WHEN** Dashboard data is prepared from provider metadata
- **THEN** the serialized projection contains aggregate counts and states but no credential or account fields

#### Scenario: One collector times out
- **WHEN** a new overview collector times out or throws
- **THEN** its field resolves to unavailable and the rest of the Dashboard renders

### Requirement: Runtime summaries are accessible and responsive
At desktop width the Runtime Profile SHALL remain a single compact row and Container Status, Projects, and AI Runtime SHALL share a three-column operational row. At widths below 1025px the operational row SHALL stack, while tablet Runtime Profile heading/action and fields SHALL form two rows. Below 768px, fields SHALL render as a two-column label/value definition list, AI Runtime rows SHALL stack, interactive targets SHALL be at least 44 CSS pixels high, and links and details SHALL be keyboard accessible. AI Runtime labels SHALL remain on one line and aggregate values MAY wrap within their available width. Accessible names SHALL include both the field label and visible state.

#### Scenario: Dashboard is viewed below 768px
- **WHEN** the viewport width is less than 768 CSS pixels
- **THEN** Runtime Profile fields and AI Runtime rows stack without horizontal scrolling or clipped status text

#### Scenario: Dashboard is viewed at desktop width
- **WHEN** the viewport width is at least 1025 CSS pixels
- **THEN** Container Status, Projects, and AI Runtime occupy one equal-column operational row and the Subagents label remains readable on one line

#### Scenario: Keyboard user inspects security details
- **WHEN** keyboard focus reaches the Security status
- **THEN** the same detail available on pointer hover is available without requiring a pointer
