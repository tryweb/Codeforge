## 1. Lock Configuration Normalization Behavior

- [x] 1.1 Add failing tests for removal of `[opencode].agents`, conversion of known tool permission entries, preservation of top-level agent models, and preservation of unrelated settings.
- [x] 1.2 Add failing tests proving normalization is byte-idempotent and retains unsupported permission shapes with an actionable error instead of weakening them.
- [x] 1.3 Update shipped-default assertions to require schema-valid `tools` restrictions and prohibit agent `permission` keys and `[opencode].agents` model entries.

## 2. Normalize OMO Configuration

- [x] 2.1 Update `.opencode/omo.jsonc.default` so restricted agents use `tools` booleans, redundant allow-all permissions are omitted, and primary model values exist only under top-level `agents`.
- [x] 2.2 Implement an atomic, snapshot-backed normalization helper that removes stale `[opencode].agents`, converts only known permission shapes, and preserves all unrelated JSONC content semantically.
- [x] 2.3 Integrate normalization into `entrypoint.d/02-init-config.sh` before OMO starts and emit the exact incompatible path when a permission shape cannot be safely converted.
- [x] 2.4 Add rollback and failure-path coverage proving a failed transformation leaves the original persistent configuration usable.

## 3. Align Admin Model Semantics

- [x] 3.1 Update the Admin agent-model read result to compare top-level configured primary models with live `/agent` provider/model values and report invalid, effective, or runtime-mismatch state.
- [x] 3.2 Ensure the write path updates only `agents.<name>.model`, accepts only live OMO subagents and active-catalog `provider/model` identifiers, and preserves supported sibling settings.
- [x] 3.3 Update apply verification so persisted/restart failures roll back while a reachable live-model mismatch is returned explicitly without silently claiming effectiveness.
- [x] 3.4 Add route and library tests for effective, invalid-config, unavailable-model, non-subagent, and applied-but-runtime-mismatch outcomes.

## 4. Verify Real Librarian Execution

- [x] 4.1 Extend the managed-server E2E test to snapshot the OMO file, configure librarian to `opencode/nemotron-3.5-lightning-free`, restart, and assert `/agent` reports that model.
- [x] 4.2 Create and prompt a real librarian child session without an explicit model, then assert the completed assistant message records provider `opencode` and model `nemotron-3.5-lightning-free`.
- [x] 4.3 Install trap-based cleanup before mutation and prove every failure path restores the byte-identical config and deletes parent and child verification sessions.
- [x] 4.4 Run targeted normalization/Admin tests, the full test suite, TypeScript build, pinned OMO migration dry run, and the real child-session E2E; record any unrelated pre-existing failures separately.

## 5. Update Operational Knowledge

- [x] 5.1 Update model-resolution troubleshooting documentation with the canonical top-level model source, removed legacy precedence layer, validation diagnostics, and execution-level verification procedure.
