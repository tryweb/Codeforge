## Context

目前 `PUT /api/agent-models/:agent` 每存一次就 `snapshot → jq 寫入 → restartManagedOpenCode → verify` 一次，`194` 上連續 `kill → 180s health` 造成 `7/0/7`。而 `reconcileAll` 已是 `applyAndVerifyBatch` 的批次語意（一次快照、一次 `join(" && ")`、一次重啟）。見 `proposal.md` 的 Why。

## Goals / Non-Goals

**Goals:**
- 單次重啟完成 N 筆變更，沿用現有 `applyAndVerifyBatch` 的 rollback 語意
- 前端收集 `pending` 後一次 Apply，期間可 Discard

**Non-Goals:**
- 不改 `~/.omo/omo.jsonc` 的 `$schema` 釘選與 `provider/model` 校驗規則
- 不引入新資料庫或外部佇列
- 不自動 debounce 儲存（改為顯式 Apply）

## Decisions

- **Decision: 新增 `PUT /api/agent-models` 批次端點，保留 `PUT /:agent` 相容**
  - *Why:* 直接複用 `lib.applyAndVerifyBatch`，啟動與 UI 共用同一路徑；單筆仍可用於快速單改。
  - *Alternative:* 完全移除單筆 → 破壞相容；前端 debounce 自動批次 → 隱含重啟時機不明，改為顯式 Apply 更可預期。

- **Decision: 前端 `pending: Map<agent, entries>` + 頂部 `Apply (n)`**
  - *Why:* 避免每 `select` 就重啟；`dirty` 以黃點標示，與 `194` 的 180s 重啟成本匹配。
  - *Alternative:* 每 `select` 自動 `debounce 2s` 後批次 → 使用者難以掌握重啟時機。

- **Decision: 後端批次內一次 `snapshot` 與 `join(" && ")`**
  - *Why:* 原子寫入多個 `agents.*.model`，失敗時整批 `write_failed` 回滾，成功時才重啟一次。

## Risks / Trade-offs

- [Risk] 批次中某 agent 的 `probe_failed` 觸發整批 rollback → Mitigation: 沿用現有 `probe_failed → restore + re-restart` 語意，前端以 `rollback_failed` 逐列提示，使用者可縮小批次重試
- [Risk] `Apply` 的 210s 超時（`150s` wait + `30s` 寫入 + 驗證）→ Mitigation: 前端 `AbortController` + `disabled` 期間禁止二次 Apply，後端 `deps.exec` 已有 `150_000`/`210_000` 超時
- [Risk] 舊前端仍呼叫單筆 `PUT /:agent` 造成多次重啟 → Mitigation: 保留單筆但文件標記為相容，UI 預設走批次

## Migration Plan

1. 部署後端批次路由（無遷移，`omo.jsonc` 格式不變）
2. 部署前端 `pending/Apply`（舊單筆仍可用）
3. 回滾：移除 `PUT /api/agent-models` 批次路由，前端回退至逐筆 `PUT /:agent`
