## Context

See `proposal.md` for motivation and `specs/admin-agent-model-selection-modes/spec.md` for the behavior contract. The current Admin flow receives connected models as flat `provider/model` references, ranks them with Agent capability policy, and has a separate Apply path with restart, real request verification, probe, and rollback. The external models.dev catalog supplies supplemental model metadata but is not authoritative for runtime connectivity.

## Goals / Non-Goals

**Goals:**

- Add a small, deterministic policy layer to the existing Provider-filtered suggestions endpoint.
- Keep the UI default convenient without changing old API callers' behavior.
- Make cost, freshness, ranking, and failure states observable and testable.
- Keep external metadata retrieval server-side and bounded.
- Preserve manual configuration and the existing Apply safety contract.

**Non-Goals:**

- No persisted selection mode in `omo.jsonc` for this version.
- No fallback chains, automatic runtime switching, or suggestion-time inference probes.
- No arbitrary external metadata URL configured by a request or browser.
- No measured latency guarantee or benchmark synthesis beyond comparable catalog data.

## Decisions

### Separate UI default from API compatibility

The UI initializes the selector to `free` and always sends the selected mode. The API treats an omitted `mode` as the existing capability-only behavior, preventing an unannounced behavior change for current callers. Explicit mode requests use the new response schema; legacy requests retain their existing response shape.

Alternative considered: default every API request to `free`. Rejected because existing callers do not send `mode`, and OpenCode Go may have no active free candidate.

### Use one fixed server-side catalog fetch

The metadata client fetches `https://models.dev/api.json` once per suggestion request, filters the returned provider map to the selected Provider IDs, and caches only validated snapshots. Requests use a three-second timeout. The source is fixed in server code rather than accepted from the browser, preventing arbitrary outbound requests and avoiding CORS or HTML scraping.

Alternative considered: fetch one Provider page per selected Provider. Rejected because it increases latency and rate-limit exposure; the machine-readable catalog already contains all Providers.

### Treat connected OpenCode models as the availability boundary

The candidate pipeline intersects normalized external records with the existing connected OpenCode catalog using complete Provider/model identity. External records cannot add candidates, clear a connection failure, or override deprecated/runtime state reported by OpenCode. The existing Apply endpoint remains the final catalog and runtime validation boundary.

Alternative considered: trust models.dev as the complete model list. Rejected because catalog snapshots can include unavailable or credential-inaccessible models.

### Fixed freshness and failure policy

The cache policy uses `METADATA_TIMEOUT_MS = 3000`, `FREE_FRESH_TTL_MS = 3600000`, and `OTHER_USABLE_TTL_MS = 21600000`. A fresh cache is usable for every explicit mode. A cache older than one hour but no older than six hours is stale: economy and performance may use it with `stale_metadata`, while free excludes it. Older or absent cache is unavailable for mode-aware suggestions and yields HTTP 200 with empty suggestions plus `metadata_unavailable`; it never blocks manual PUT behavior. Legacy requests without `mode` bypass this dependency and keep their current behavior.

### Keep ranking simple and deterministic

Normalized candidate records retain raw metadata for display but expose these ranking values:

- Economy effective cost: `inputPrice * 0.6 + outputPrice * 0.4`; missing either price is `Infinity`.
- A missing or unknown `contextLimit` is context-inadequate; any known context limit is adequate for this version because the existing system has no Agent-specific minimum context contract.
- Economy order: effective cost ascending → existing Agent capability score descending → complete model reference ascending.
- Performance order: comparable benchmark score descending when present → existing capability score descending → context limit descending → output limit descending → metadata freshness descending → complete model reference ascending.

Performance sets `heuristic: true` when the candidate set has no comparable benchmark score. This avoids inventing a quality or latency metric and leaves future benchmark ingestion as a separate change.

Alternative considered: price-descending as a performance proxy. Rejected because price is not a reliable measure of coding quality or latency.

### Do not probe while generating suggestions

Generate Suggestions performs only connected-catalog filtering, metadata enrichment, and ranking. It does not call `probeModel`, create temporary sessions, restart OpenCode, or write configuration. An accepted recommendation uses the existing Apply path, which performs the required real usability verification and rollback.

Alternative considered: probe the top candidates during generation. Rejected because it adds inference cost and latency to a read-only preview and duplicates the existing Apply verification.

### Cache failure is visible but non-blocking

The explicit-mode response always reports `sourceStatus`, optional `sourceAgeMs`, and bounded warning codes. A stale or unavailable external source disables only the metadata-dependent mode recommendations; connected catalog data remains available for manual selection and legacy capability-only suggestions. No missing price or capability is synthesized.

## Risks / Trade-offs

- [Catalog and billing divergence] → Show source age and raw pricing metadata; treat the catalog as indicative and retain manual override and Apply verification.
- [OpenCode Go has no active free candidate] → Exclude deprecated zero-price records and return an explicit no-free result rather than a paid fallback.
- [Provider/model identity mismatch] → Require complete identity matching and exclude unmatched records.
- [Stale zero-price metadata] → Block stale free-mode candidates after the one-hour TTL.
- [External outage] → Return HTTP 200 with empty mode-aware suggestions and warning; do not block manual configuration or legacy suggestions.
- [Performance ranking is heuristic] → Mark responses heuristic without comparable benchmarks and do not claim measured superiority.
- [Large catalog or repeated requests] → Fetch once per request, filter in memory, and use a bounded validated cache rather than per-candidate requests.

## Migration Plan

1. Add the metadata client, normalized records, and explicit-mode endpoint behavior without changing persisted configuration.
2. Add the UI mode selector with initial value `free`; the UI always sends an explicit mode.
3. Keep API callers that omit `mode` on the existing response and capability-only ranking path.
4. Roll out recommendation display before any automatic apply behavior; accepted recommendations still require the existing Apply flow.
5. If models.dev is unreachable, mode-aware suggestions degrade to the documented empty response while manual and legacy behavior remains available.
6. Roll back by removing the explicit-mode UI/API path; existing `provider/model` values and verification logic remain valid.

## Open Questions

None. The timeout, TTLs, response fields, fallback behavior, and ranking formulas are fixed by the specification and can be implemented and tested without further product decisions.
