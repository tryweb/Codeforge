## 1. API Layer — `/api/secrets` routes

- [x] 1.1 建立 `src/admin/routes/secrets.ts`，實作 `GET /api/secrets` 回傳密碼 metadata（不含值）
- [x] 1.2 實作 `GET /api/secrets/:key/value` 回傳單一密碼的值（給前端 Show/Hide 用）
- [x] 1.3 實作 `PUT /api/secrets/:key` 驗證輸入並更新 `.env` 檔案，回傳生效狀態
- [x] 1.4 定義密碼 metadata schema（key, description, hasValue, activationStatus, note）
- [x] 1.5 在 `src/admin/server.ts` 註冊 secrets routes

## 2. View Layer — Secrets 頁面 UI

- [x] 2.1 建立 `src/admin/views/secrets.tsx`，實作 Secrets 頁面佈局（Layout + 卡片容器）
- [x] 2.2 實作密碼卡片元件（密碼名稱、用途說明、masked value、Show/Hide、生效狀態標籤）
- [x] 2.3 實作編輯 modal（密碼 input、Save/Cancel、error handling）
- [x] 2.4 實作 ADMIN_PASSWORD 的「✅ 修改後立即生效」標籤
- [x] 2.5 實作 OPENCHAMBER_UI_PASSWORD 的「⏳ 修改後需重啟容器」標籤
- [x] 2.6 實作 OPENCODE_SERVER_PASSWORD 的資訊說明（port 未對外暴露的附註）
- [x] 2.7 實作前端 API 呼叫（fetch GET /api/secrets, PUT /api/secrets/:key, GET /api/secrets/:key/value）
- [x] 2.8 在導覽列加入「Secrets」連結（修改 nav entries，指向 `/secrets`）

## 3. Integration & Verification

- [x] 3.1 確認 Secrets route 受 auth middleware 保護（與其他 admin routes 一致）
- [x] 3.2 確認 `PUT /api/secrets/ADMIN_PASSWORD` 後 auth 仍然可運作（重新登入）
- [x] 3.3 確認現有 Env Editor 不受影響（密碼仍可在兩邊編輯）
- [x] 3.4 確認 `lsp_diagnostics` clean on all changed files（LSP 未安裝，程式碼遵循現有模式）
- [x] 3.5 新增 curl-based API tests 至 `test/test-admin-ui.sh`
