## Context

See `proposal.md` for motivation. The Dashboard currently receives site, gain, Decision Loop, evidence, and savings reports directly in `DashboardData`, renders repeated LeanCTX values in separate full-width cards, and does not consume Center, Provider, Agent Model, or effective LeanCTX configuration state. Existing domain collectors distinguish configured values from runtime/effective values, but their full return types contain detail that does not belong on the Dashboard.

The LeanCTX editor intentionally tracks unsaved/saved state locally. `lean-ctx config show` reports merged effective limits but does not prove which saved file revision the daemon last loaded, so the Dashboard must not infer `Applied` from readable TOML alone.

## Goals / Non-Goals

**Goals:**
- Keep Dashboard status projections small, typed, secret-free, failure-isolated, and deterministic.
- Make every visible label, tone, ordering rule, empty state, and destination testable.
- Preserve a stable layout while escalating actionable anomalies.
- Reuse existing status collectors and semantic CSS tokens.

**Non-Goals:**
- Editing LeanCTX, Center, Provider, or Agent Model settings from the Dashboard.
- Displaying provider accounts, credentials, individual model assignments, or complete errors.
- Adding a second analytics surface or new polling framework.
- Claiming that external CLI applies are confirmed by ai-admin.

## Decisions

### 1. Project domain state into Dashboard-only aggregate types

`DashboardData` will receive dedicated projections rather than full domain objects:

```ts
type Tone = "success" | "warning" | "danger" | "neutral";

interface LeanCtxRuntimeProfile {
  applyState: "applied" | "pending" | "saved-only" | "runtime-unavailable";
  source: "applied-snapshot" | "saved-config" | "unavailable";
  compressionLevel: "off" | "lite" | "standard" | "max" | null;
  toolProfile: "minimal" | "standard" | "power" | null;
  permissionInheritance: "on" | "off" | null;
  crossProjectSearch: boolean | null;
  secretDetectionEnabled: boolean | null;
  secretRedactionEnabled: boolean | null;
  archiveEnabled: boolean | null;
  archiveMaxAgeHours: number | null;
  archiveMaxDiskMb: number | null;
}

interface CenterSummary {
  state: "connected" | "disabled" | "disconnected" | "unavailable";
}

interface ProviderSummary {
  state: "ready" | "needs-credentials" | "pending-activation" | "invalid" | "none" | "unavailable";
  totalCount: number;
  issueCount: number;
}

interface SubagentSummary {
  state: "effective" | "awaiting-request" | "unverified" | "runtime-mismatch" | "invalid" | "none" | "unavailable";
  configuredCount: number;
  worstCount: number;
}
```

Projection functions accept existing domain results and return these types. They must be pure and unit-tested. `permissionInheritance` preserves the schema's `"on" | "off"` representation and is converted to `On` / `Off` only by the presentation helper. `ProviderSummary` derives ready count as `totalCount - issueCount` only for the needs-credentials state, and `SubagentSummary.worstCount` is the count for the selected worst state. Full domain errors and identities never cross into Dashboard JSX.

Alternative considered: pass existing Provider and Agent Model view state to the Dashboard. Rejected because it increases response size, couples the Dashboard to management-page details, and risks credential/account leakage.

### 2. Persist an Admin-confirmed applied LeanCTX snapshot

On successful Admin Apply, canonicalize the schema-supported config and atomically persist `/opt/ai-engkit/admin-data/leanctx-applied-snapshot.json` as a mode-`0600` local file using exclusive temp-file creation plus rename. The fixed `version: 1` record stores only the Runtime Profile whitelist and a SHA-256 fingerprint of a stable, recursively key-sorted JSON serialization of the complete schema-supported configuration. This version marker is a fail-closed format discriminator, not a speculative migration framework. On Dashboard load:

1. Read the saved supported config and canonical fingerprint.
2. Read and validate the applied snapshot.
3. Equal hashes → `applied`, values from snapshot.
4. Different hashes → `pending`, values from snapshot.
5. No snapshot plus readable saved config → `saved-only`, values from saved config.
6. Neither source readable → `runtime-unavailable`.

An Apply failure does not modify the snapshot. Unsupported or malformed snapshot versions fail closed to `saved-only`. External CLI applies do not update this Admin-confirmed file and therefore remain intentionally unconfirmed.

Alternative considered: parse `lean-ctx config show`. Rejected as proof of apply state because it reads merged configuration and does not establish which revision the running daemon loaded. The snapshot is deliberately described as “last Admin-confirmed apply”; external CLI applies remain unconfirmed.

### 3. Keep display order fixed and derive copy centrally

Create pure presentation helpers that map aggregate states to `{ label, value, tone, href, ariaLabel }`. JSX renders a fixed order and never reorders rows by severity. All copy and number formatting comes from the exact rules in the capability specs; helpers use explicit `en-US` formatting rather than process locale. The AI Runtime header action was removed because the Providers and Subagents rows already provide navigation; no severity-derived header link is rendered.

The Runtime Profile order is Apply, Compression, Tools, Security, Archive, then `/leanctx`. AI Runtime rows are Providers then Subagents. Center remains in the site-summary flow and links to `/agent`.

Alternative considered: move the most severe row to the top. Rejected because positional changes make routine scanning and keyboard navigation less predictable.

### 4. Use exact semantic-token mapping

| Tone | Existing presentation | Meaning |
|---|---|---|
| `success` | `status-pill--success` / `badge-success`, `var(--success)` | confirmed healthy/applied |
| `warning` | `status-pill--warning` / `badge-warning`, `var(--warning)` | actionable or incomplete |
| `danger` | `status-pill--danger` / `badge-danger`, `var(--danger)` | invalid, mismatched, or unavailable critical state |
| `neutral` | `status-pill--neutral`, `var(--text-muted)` | intentional standalone, unknown, or awaiting evidence |

Mode choices such as Compression `Max` are neutral values, not health judgements. Security uses the precedence defined in the new capability spec. Visible text always accompanies tone.

### 5. Provider readiness uses effective credential paths

Readiness is derived without exposing credentials:

- Ready: OAuth connected, auth-store key present for key-managed providers, or a configured credential path for non-key-managed providers.
- Pending activation: registry has an active selection but effective auth-store credential is absent.
- Needs credentials: configured provider has no effective credential path.
- Invalid outranks all other states; then pending activation; then needs credentials; then ready; no providers and unavailable are explicit states.

Only the highest-precedence non-zero state is rendered. Singular/plural and zero-ready copy follows `admin-dashboard-runtime-overview/spec.md`; no JSX branch may invent alternate wording.

Do not claim a global `Restart required` state because the current routes return that result per mutation and do not persist a global pending flag. `Pending activation` is shown only when effective metadata proves registry/auth-store divergence.

### 6. SubAgent aggregation is configured-scope and worst-state-first

Exclude plugin-only rows from the configured denominator. Count current `AgentModelEntry.effectiveness` states and choose copy in this order: invalid, runtime mismatch, unverified, awaiting request, effective. Only one issue phrase appears to keep the card compact; accessible detail may include all counts. `awaiting_request` always renders as `awaiting verification`; all singular/plural and zero-config copy follows `admin-dashboard-runtime-overview/spec.md`. Awaiting request remains neutral because it represents missing evidence, not failure.

### 7. LeanCTX Insights becomes one container with four subsections

The section order is Savings Economics, Decision Quality, Evidence, then Top Saving Tools. Each subsection owns unique facts:

- KPI row: net tokens, net USD, compression; memory facts/coverage; activity/ledger event summary.
- Savings Economics: gross tokens/USD, overhead USD/bounce tokens, ledger verification.
- Decision Quality: assessed, acceptance, CPAO, ETPAO.
- Evidence: proven tasks, chain completeness, ledger items.
- Top Saving Tools: top five source, token, and share values.

Subsection failures are local. The section remains visible if any subsection has data. Projects loses all LeanCTX aggregate rows and remains an operational navigation card.

When `admin_version` is `dev`, the `✓ Latest` badge is suppressed in both the Site Summary and the Component Versions `AI-EngKit` row; actionable states (`▲ Upgrade`, `● Pinned`, `? unavailable`) remain. LeanCTX Insights and Component Versions share heading/table rhythm per polish option 1 — 12px heading bottom margin and 10px×12px cell padding with 4px top table offset — without content or breakpoint changes.

### 8. Links are explicit and non-nested

- Center status → `/agent`.
- Runtime Profile CTA → `/leanctx`.
- Providers row → `/providers`.
- Subagents row → `/agent-models`.
- Site-summary Projects → `/projects`.
- Projects operational card → `/projects`.
- Site-summary GitHub → `/auth/github`.
- Site-summary GitLab → `/auth/gitlab`.
- Site-summary Git → `/git-config`, including the `not configured` state.
- AI-EngKit version in Component Versions → `/versions`; other version rows remain non-linked.

The AI Runtime header action was removed because the two row links already provide navigation; the card container itself is not clickable. This avoids nested interactive elements and preserves distinct keyboard targets. Tooltips/details use focusable disclosure semantics rather than hover-only content.

### 9. Data collection is parallel, bounded, and nullable

Dashboard collection reuses existing Center status synchronously and existing Provider/Agent Model collectors through aggregate wrappers. New asynchronous work runs in parallel with current probes, has the existing ten-second upper bound or a stricter domain timeout, and converts failure to an unavailable aggregate. It must not serialize Center, LeanCTX, Provider, and model calls.

No Dashboard-specific cache is introduced. Existing domain-level caching may continue to operate unchanged. Tests must prove a failed collector does not reject the page, and performance evidence must justify any future caching change.

### 10. Responsive structure uses layout classes, not inline duplication

Desktop keeps Runtime Profile in one row. Tablet uses a heading/action row plus wrapping field row. Below 768px, Runtime Profile uses a label/value definition list and AI Runtime rows stack. The same DOM content is restyled rather than duplicated, preserving accessible names and avoiding divergent copy. Interactive rows and CTAs have a minimum 44px target.

The Container Status, Projects, and AI Runtime cards use a shared `.dashboard__ops-row`: three equal columns at desktop widths and one column at widths below 1025px. Within AI Runtime rows, labels use a non-shrinking single-line treatment while aggregate status values may wrap within the available card width.

## Risks / Trade-offs

- [Applied snapshot can miss external CLI applies] → Label it as Admin-confirmed, fail conservatively to pending/saved-only, and never infer daemon state from TOML alone.
- [Provider/model live collection can slow Dashboard] → Project, cache, run in parallel, bound timeouts, and render unavailable independently.
- [Too many neutral states can look like errors] → Reserve amber/red for actionable conditions; `Standalone`, `awaiting verification`, and unknown non-critical fields remain neutral.
- [Aggregates can hide which item is broken] → Link each row directly to its dedicated management page; no header Review/Manage action is needed because rows provide navigation.
- [Existing value-metric tests expect separate panels] → Update tests to assert semantic subsection ownership and absence of duplicate values rather than old card boundaries.

## Migration Plan

1. Add pure projection types/helpers and tests without changing rendered Dashboard behavior.
2. Add versioned applied-snapshot persistence and update Apply tests.
3. Extend Dashboard data collection with nullable aggregates and failure-isolation tests.
4. Replace Dashboard markup and styles, then update view/accessibility/responsive tests.
5. Run Admin unit/integration tests, type checks, and browser visual QA at 375px, 768px, and 1280px.

Rollback removes the new rendering/data projections while leaving the applied snapshot file harmless and ignored. No existing configuration or credential format is migrated.
