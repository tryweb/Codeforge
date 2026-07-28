## Why

Admin dashboard 的 Env Editor 將一般環境變數與密碼混在一起編輯，使用者無法直觀區分哪些是敏感資訊、哪些修改後需要重啟容器。實際上 `ADMIN_PASSWORD` 修改後即時生效（auth.ts 每次從 `.env` 重讀），但 UX 完全沒有傳達這件事。同時 `OPENCODE_SERVER_PASSWORD` 在目前架構下 port 未對外暴露，修改效益有限但沒有說明。將密碼獨立管理可以改善操作體驗與安全認知。

## What Changes

- Admin 導覽列新增「Secrets」分頁，獨立於現有的「Environment」分頁
- Secrets 頁面以卡片形式呈現三個密碼：`ADMIN_PASSWORD`、`OPENCHAMBER_UI_PASSWORD`、`OPENCODE_SERVER_PASSWORD`
- 每個密碼卡片顯示：
  - 密碼名稱與用途說明
  - 目前值（預設 masked，可 Show/Hide）
  - 編輯按鈕 → inline modal 編輯
  - 儲存後的回饋標示：即時生效 / 需重啟容器 / 選用說明
- 新增獨立的 API route `/api/secrets`（對應 CRUD）
- 新增獨立的 route `/secrets`（JSX page）
- 密碼編輯功能與 Env Editor 脫鉤，Env Editor 可考慮移除非密碼變數（此階段不改動 Env Editor）

## Capabilities

### New Capabilities
- `secrets-management`: 獨立密碼管理頁面，包含卡片式佈局、獨立 API、即時生效回饋

### Modified Capabilities

（無 — Env Editor 原有的 env editing 功能不受影響）

## Impact

- **New routes**: `src/admin/routes/secrets.ts` — `GET /api/secrets`, `PUT /api/secrets/:key`
- **New view**: `src/admin/views/secrets.tsx` — Secrets 頁面 UI
- **New nav entry**: `src/admin/views/dashboard.tsx` — 導覽列加入 Secrets 連結
- **Route registration**: `src/admin/server.ts` — 掛載 secrets routes
- **Env lib unchanged**: `src/admin/lib/env.ts` — 重用現有的 `readEnvFile`/`upsertEnvVar`
- **Auth lib unchanged**: `src/admin/lib/auth.ts` — 密碼驗證邏輯不變
