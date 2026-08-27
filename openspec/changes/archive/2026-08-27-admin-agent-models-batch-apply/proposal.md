## Why

每儲存一個 agent 就重啟一次 managed OpenCode，會在 194 上連續觸發 kill → 180s health 競態，導致 7/0/7 health timeout，且與啟動時的批次 reconcileAll 語意不一致。批次編輯後一次重啟可將 N×210s 降為 1×210s，大幅降低失敗率並讓 Admin UI 與啟動流程共用同一批次語意。

## What Changes

- 新增批次寫入端點 PUT /api/agent-models 接受 changes: [{agent, entries}]，在伺服器端呼叫現有的 lib.applyAndVerifyBatch(changes) 完成一次快照、一次 join(" && ") 寫入、一次 restartManagedOpenCode、逐一 verifyAppliedAgent，並回傳 Map<agent, ApplyResult>。
- 保留 PUT /api/agent-models/:agent 供相容，但文件標記為單筆相容路徑，建議批次優先。
- Admin UI agent-models 改為本地 pending: Map<agent, entries> 髒狀態：select 只改 pending 並標 dirty（黃點），不立即 fetch；頂部常駐 Apply (n) / Discard，Apply 才發批次請求，期間按鈕 disabled + spinner，完成後以批次回傳更新各列 verified/unverified/restart_failed。
- 失敗時沿用 applyAndVerifyBatch 的 rollback 語意（write_failed/restart_failed/probe_failed → rollback），前端以批次結果逐列顯示。

## Capabilities

### New Capabilities
- admin-agent-models-batch: 批次設定多個 agent 的主模型並以單次重啟完成驗證

### Modified Capabilities
- admin-agent-model-config: 將「儲存即重啟」改為「批次 Apply 才重啟」；entries 仍為 0 或 1 筆，單筆 PUT 保留但文件改為相容路徑

## Impact

- 後端：src/admin/routes/agent-models.ts 新增批次路由，複用 src/admin/lib/agent-models.ts 的 applyAndVerifyBatch；src/admin/lib/restart-ai-dev.ts 與 agent-model-reconcile-cli.ts 已支援 RECONCILE_STARTUP_NO_RESTART
- 前端：src/admin/views/agent-models.tsx 增加 pending 與 Apply 狀態
- 測試：src/admin/lib/restart-ai-dev.test.ts、src/admin/routes/agent-models.test.ts 擴充批次案例
- 依賴：無新增依賴，沿用現有 opencode catalyst 與 jq 寫入
