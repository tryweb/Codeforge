## 1. Backend batch endpoint

- [x] 1.1 Add PUT /api/agent-models batch route that validates `{changes: [{agent, entries}]}` (0 or 1 entry, variant, catalog) and calls `lib.applyAndVerifyBatch(changes)` once, returning `{results}` and verify with `bun test src/admin/routes/agent-models.test.ts` batch case
- [x] 1.2 Keep PUT /api/agent-models/:agent as compatibility path and update its docs, verify single-agent still returns ApplyResult

## 2. Frontend pending Apply UX

- [x] 2.1 Add pending Map<agent, entries> and dirty indicator to `src/admin/views/agent-models.tsx`, select only mutates pending and verify UI shows yellow dot without fetch
- [x] 2.2 Add top Apply (n) / Discard bar that on Apply sends single PUT /api/agent-models with all pending, disables during 210s, shows spinner, and on success clears pending and re-renders per-agent verified/unverified from batch results
- [x] 2.3 Surface per-agent batch result (verified, unverified, restart_failed, rollback_failed) inline and verify with manual 3-agent batch in dev

## 3. Verification

- [x] 3.1 Run `bun test src/admin/lib/restart-ai-dev.test.ts` and confirm batch still uses single restart (join " && ") and `git diff --check` passes
- [ ] 3.2 Run 7-old -> new batch via Admin UI on 194 (reset 7 to openai, Apply once) and verify `docker logs --since` shows single `reconciled: changed=7 applied=7` without `health timeout`
