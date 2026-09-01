## 1. Design Contract and Test Fixtures

- [x] 1.1 Update root `DESIGN.md` with the compact Runtime Profile and AI Runtime primitives, fixed section order, semantic tone tokens, 44px interaction targets, and 1280/768/375px layouts; verify every new class and state in the implementation traces to a documented token or primitive.
- [x] 1.2 Add typed Dashboard projection fixtures covering every Center, Runtime Profile, Provider, and SubAgent state; verify fixtures contain no key, token, account, URL, model-reference, or raw-error fields.
- [x] 1.3 Add failing unit tests for exact display copy, `en-US` number formatting, singular/plural and zero-state rules, semantic tone, severity precedence, fixed field/row order, and `/agent`, `/leanctx`, `/providers`, and `/agent-models` destinations before implementing projection helpers.

## 2. LeanCTX Applied Snapshot

- [x] 2.1 Add a fixed-version applied-snapshot reader/writer for `/opt/ai-engkit/admin-data/leanctx-applied-snapshot.json` using exclusive mode-`0600` temp-file creation and atomic rename; verify round-trip, malformed-file, unsupported-version, file-permission, exact-whitelist, and secret-field rejection tests pass.
- [x] 2.2 Canonicalize the complete schema-supported LeanCTX configuration with recursively sorted JSON keys and SHA-256, project the Runtime Profile whitelist including `permissionInheritance: "on" | "off" | null`, and derive `applied`, `pending`, `saved-only`, and `runtime-unavailable`; verify key-order independence, equal hashes, drift, missing snapshot, unreadable config, and applied-value retention during pending changes.
- [x] 2.3 Record the applied snapshot only after successful `lean-ctx config apply` and preserve the prior snapshot on failure; verify route/lib tests prove failed Apply cannot advance the confirmed fingerprint.

## 3. Dashboard Aggregate Data

- [x] 3.1 Implement pure Center and Runtime Profile projection helpers with exhaustive typed state handling; verify the exact copy/tone tests from task 1.3 pass.
- [x] 3.2 Implement secret-free Provider readiness aggregation with invalid, pending activation, needs credentials, ready, none, and unavailable precedence; verify exact singular/plural copy, zero-ready copy, co-occurring-state precedence, OAuth, auth-store, registry divergence, invalid JSON, zero-provider, and failure tests pass.
- [x] 3.3 Implement configured-scope SubAgent aggregation with `invalid > runtime_mismatch > unverified > awaiting_request > effective` precedence and plugin-only exclusion; verify exact invalid/mismatch/unverified/awaiting/effective copy, singular/plural rules, mixed-state precedence, unavailable catalog, and `No SubAgents configured` pass.
- [x] 3.4 Extend Dashboard data collection to run new nullable collectors in parallel without a Dashboard-specific cache and isolate failures; verify a timeout or exception in each individual collector still returns a renderable Dashboard with the other summaries populated.

## 4. Dashboard Rendering

- [x] 4.1 Add the linked Center item to Site Summary with `Connected`, `Standalone`, `Disconnected`, and `Unavailable` copy; verify rendered markup uses `/agent`, contains no Center configuration detail, and exposes label plus state to assistive technology.
- [x] 4.2 Add the read-only LeanCTX Runtime Profile in Apply, Compression, Tools, Security, Archive order with `/leanctx` CTA and focus-accessible security details; verify all specified applied/pending/saved-only/unavailable and security precedence cases render exact copy and tone.
- [x] 4.3 Add the AI Runtime card with fixed Providers/Subagents rows and row-level links (header Manage/Review action removed in polish — rows provide navigation); verify row destinations remain `/providers` and `/agent-models`, the header contains no `Manage`/`Review` action, and labels remain readable in the desktop operational row.
- [x] 4.4 Remove LeanCTX facts/activity/health rows from Projects and consolidate Savings Economics, Decision Quality, Evidence, and Top Saving Tools in that fixed order within one Insights container; verify exact number formatting, `Data unavailable` subsection isolation, and that net savings, compression, memory, activity, health, and duplicate acceptance values appear only in their owning section.
- [x] 4.5 Render at most five saving tools in descending token order with proportional share bars and local empty/unavailable states; verify one failed subsection does not hide successful Insights subsections.

## 5. Responsive, Accessibility, and Security Verification

- [x] 5.1 Add responsive styles for one-row desktop Runtime Profile, three-column desktop operational cards, two-row tablet layout, and stacked mobile definition-list/AI Runtime rows; verify Playwright captures at 1280px, 1024px, 768px, 375px, and 320px have no clipping and assert `document.documentElement.scrollWidth === window.innerWidth`.
- [x] 5.2 Verify keyboard traversal, visible focus, focus-accessible status details, non-nested links, semantic section/list/table markup, and minimum 44px interactive targets with Playwright accessibility assertions.
- [x] 5.3 Run focused Dashboard tests and affected Playwright checks; verify `bun test src/admin/views/dashboard.test.ts src/admin/lib/dashboard-aggregates.test.ts` exits zero with 45 passing tests, and record unrelated full-repository TypeScript/LSP limitations without attributing them to this change.
- [x] 5.4 Inspect the rendered Dashboard response and serialized fixtures for credential/account/model-detail leakage, then exercise collector failures in a real Dashboard load; verify only aggregate counts, enums, booleans, retention limits, and approved copy inputs are present.
- [x] 5.5 Run `/visual-qa` against fresh 375px, 768px, and 1280px evidence and verify zero must-fix design-system or visual-fidelity findings before marking the change complete.

## 6. Post-implementation Dashboard polish

- [x] 6.1 Put Container Status, Projects, and AI Runtime in `.dashboard__ops-row` with three equal desktop columns and one-column tablet/mobile fallbacks; preserve existing row links and non-nested interactive elements.
- [x] 6.2 Add Dashboard deep links for both Projects surfaces, GitHub, GitLab, Git, and the AI-EngKit version while preserving state text, update badges, and accessibility labels.
- [x] 6.3 Prevent AI Runtime labels from shrinking into vertical text by keeping labels on one line and allowing aggregate status values to wrap safely; verify fresh 1280/1024/768/375/320 captures and two independent visual QA passes report no findings.
