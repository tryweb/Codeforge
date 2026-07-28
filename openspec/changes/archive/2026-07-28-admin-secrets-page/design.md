## Context

Admin dashboard 目前有一個統一的 Env Editor 頁面 (`/env`)，可編輯 `.env` 中的所有變數。密碼與一般設定混雜，且 UX 沒有區分不同密碼的生效條件：

| 密碼 | 目前行為 | 實際需求 |
|------|---------|---------|
| `ADMIN_PASSWORD` | 寫入 .env + 提示重啟容器 | 寫入後即時生效，不需重啟 |
| `OPENCHAMBER_UI_PASSWORD` | 同上 | 寫入後需重啟 ai-dev 容器 |
| `OPENCODE_SERVER_PASSWORD` | 同上 | 寫入後需重啟，但效益有限（port 未對外暴露） |

新增獨立的 Secrets 頁面，將密碼管理從 Env Editor 分離，並針對每個密碼提供正確的生效回饋。

## Goals / Non-Goals

**Goals:**
- 新增導覽列項目「Secrets」，指向獨立頁面
- 三個密碼以卡片呈現，一目了然
- 每個密碼可獨立編輯（inline modal），編輯後有對應的生效狀態回饋
- ADMIN_PASSWORD 修改後顯示「已生效」，不要求重啟
- 重用現有的 `readEnvFile` / `upsertEnvVar`（.env 檔案操作不變）
- 保留現有 Env Editor 功能不受影響

**Non-Goals:**
- 不修改 Env Editor 頁面內容（未來可考慮移除密碼，但非本次範圍）
- 不修改 auth.ts 的密碼驗證邏輯（已符合即時生效需求）
- 不實作 OpenChamber/OpenCode 的 hot-reload API 整合（Phase 2+）
- 不修改 docker-compose 或 Dockerfile

## Decisions

### D1: 新增獨立 route `/secrets`，獨立 API `/api/secrets`

**選擇**：新增 route，而非在 Env Editor 中加 tab。

**理由**：
- 關注點分離 — secrets 和一般 env vars 有不同的操作語意
- 導覽列直接可見使用者可直接點擊，不需要先進入 Env 頁面
- 每個密碼有獨立的狀態回饋（即時生效 vs 需重啟），適合卡片佈局

```
Route 結構：
GET  /secrets          → Secrets 頁面 (JSX)
GET  /api/secrets      → 回傳所有密碼及其 metadata
PUT  /api/secrets/:key → 更新單一密碼
```

### D2: 卡片式佈局

**選擇**：每個密碼一張獨立卡片，而非表格。

**理由**：
- 卡片可以容納較多的說明文字（用途、生效狀態）
- 卡片的視覺層級讓密碼比表格中的一列更醒目
- 與現有 Dashboard 的卡片風格一致
- **卡片先天適合 mobile**：垂直堆疊不需 Grid 多欄處理，現有 `@media (max-width: 768px)` 的 `.card` 規則已 cover

**Mobile 呈現**：卡片內的 action buttons（Show/Hide、Edit）使用 `flex-wrap: wrap` + `gap: 8px`，當螢幕寬度不足時自動換行，避免按鈕被截斷或溢出版面。

```
┌──────────────────────────────────────┐
│  🔐 ADMIN_PASSWORD                    │
│  ─────────────────────────────────    │
│  用途: Admin dashboard 登入密碼        │
│                                       │
│  目前值:  ●●●●●●●●   [Show]          │
│                                       │
│  ✅ Takes effect immediately          │
│                              [Edit]   │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│  🔑 OPENCHAMBER_UI_PASSWORD           │
│  ─────────────────────────────────    │
│  Purpose: OpenChamber Web UI password │
│                                       │
│  Value:  ●●●●●●●●   [Show]          │
│                                       │
│  ⏳ Restart container required        │
│                              [編輯]   │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│  🔑 OPENCODE_SERVER_PASSWORD          │
│  ─────────────────────────────────    │
│  用途: OpenCode API 認證               │
│                                       │
│  目前值:  ●●●●●●●●   [Show]          │
│                                       │
│  ℹ️ OpenCode port 未對外暴露，         │
│     此密碼在標準部署中為選用保護層      │
│     修改後需重啟容器才生效             │
│                              [編輯]   │
└──────────────────────────────────────┘
```

### D3: API 回傳結構

```typescript
// GET /api/secrets → 200
[
  {
    key: "ADMIN_PASSWORD",
    description: "Admin dashboard login password",
    hasValue: true,           // 是否有值（非空）
   生效狀態: "immediate",      // 即時生效
    category: "admin"
  },
  {
    key: "OPENCHAMBER_UI_PASSWORD",
    description: "OpenChamber Web UI login password",
    hasValue: true,
   生效狀態: "restart_required", // 需重啟
    category: "service"
  },
  {
    key: "OPENCODE_SERVER_PASSWORD",
    description: "OpenCode API authentication",
    hasValue: true,
   生效狀態: "restart_required",
    category: "service",
    note: "OpenCode port is not exposed externally in standard deployment. This password provides defense-in-depth for internal API access and is essential when connecting to a remote OpenCode server via OPENCODE_HOST."
  }
]

// PUT /api/secrets/:key → 200
// Request: { value: "new-password" }
// Response: { ok: true,生效狀態: "immediate" }
// 400: { error: "Value must be a non-empty string" }
```

`生效狀態` enum:
- `"immediate"` — ADMIN_PASSWORD 專屬，修改後無需重啟
- `"restart_required"` — 其他密碼，修改後需重啟 ai-dev 容器

### D4: ADMIN_PASSWORD 修改後不清除 session

**選擇**：修改 ADMIN_PASSWORD 後，現有 session 仍然有效。

**理由**：
- Session 是 HMAC-signed cookie，使用 ADMIN_PASSWORD 作為 secret
- 修改密碼後，已簽發的 session token 簽名變為舊 secret — 但 `validateSession()` 會先檢查 `getPassword()` 取新密碼驗證
- 實際上會造成 session 失效，使用者需要重新登入
- **替代方案**：不強制登出，讓 session 自然到期（預設同 browser session）
- 這是可接受的 tradeoff：變更 ADMIN_PASSWORD 後需重新登入，與一般系統行為一致

### D5: 密碼值傳輸安全

**選擇**：
- `GET /api/secrets` **不回傳密碼明文**，只回傳 `hasValue: boolean`
- 前端一律顯示 `●●●●●●●●`，點 Show 後透過 `GET /api/secrets/:key/value` 取得明文
- `PUT /api/secrets/:key` 接受明文密碼，走 HTTPS（localhost 部署）

**理由**：
- Env Editor 目前 `/api/env` 會回傳所有值（包含密碼明文）
- Secrets API 應該更嚴格：預設不回傳值，需要明確請求才提供
- localhost 部署下 HTTPS 非必要，但 API 設計上應最小化敏感資料暴露

### D6: OPENCODE_SERVER_PASSWORD 的呈現方式

**選擇**：保留在 Secrets 頁面中，但加上可摺疊的詳細說明。

**理由**：
- 使用者可能在安裝時設定了這個值，若頁面上完全消失會造成困惑
- 補充說明明確傳達「在標準部署中效益有限」的資訊
- 讓進階使用者知道當使用 `OPENCODE_HOST` 遠端連線時此密碼至關重要
- **可摺疊設計**：手機上 375px 寬度無法容納長段說明，預設只顯示一行「ℹ️ 了解更多」連結，點擊展開完整說明，避免佔用過多垂直空間

### D7: Mobile 相容性策略 — 繼承現有 responsive 基礎，新增卡片專屬適配

**選擇**：Secrets 頁面完全共用 admin 既有的 mobile 架構（`style.css` 的 `@media (max-width: 768px)` 規則 + `app.js` 漢堡選單），不引入新的 responsive breakpoint。

**依賴的現有機制**：

| 現有 CSS 規則 | 套用到 Secrets |
|---------------|---------------|
| `.modal { max-width: min(480px, calc(100vw - 32px)); }` | 編輯 modal 自動適應手機寬度 |
| `button, .btn-outline { min-height: 44px; }` (media query) | Show/Hide、Edit、Save/Cancel 按鈕觸控友善 |
| `.sidebar` overlay + `#nav-toggle` | Secrets 頁面繼承 Layout，漢堡選單自動運作 |
| `.card { overflow-x: auto; }` | 卡片內容不會破壞頁面寬度 |
| `.main-content { padding: 16px; }` (media query) | 手機版內容區留白適中 |

**Secrets 專屬 mobile 調整**：

- 卡片內的 action bar（Show/Hide、Edit）使用 `flex-wrap: wrap; gap: 8px`，在 ≤375px 寬度不足時自動換行
- OPENCODE_SERVER_PASSWORD 的詳細說明預設收摺，避免在手機上佔據大半螢幕
- Show/Hide 按鈕也符合 `min-height: 44px`（共用規則）
- modal 內 Edit input 在手機鍵盤彈出時順暢（現有 modal 無 `position: fixed` 與鍵盤衝突問題）

## Risks / Trade-offs

| 風險 | 影響 | 緩解方式 |
|------|------|---------|
| ADMIN_PASSWORD 修改後 session 立即失效 | 使用者需要重新登入 | 這是合理行為，不需特殊處理 |
| 新 route `/secrets` 與未來可能的 route 衝突 | 路由衝突 | Hono 的 route 是明確註冊的，新增 `/secrets` 不會影響現有 routes |
| 使用者預期「修改密碼後自動登出其他裝置」 | 安全預期落差 | Session 無狀態、存在 browser cookie，無法跨裝置失效，這是既有架構限制 |
| 與 Env Editor 的資料不一致 | 使用者從兩邊修改同一變數 | 共用同一份 .env 檔案，不存在不一致 |
| 手機上 OPENCODE_SERVER_PASSWORD 的摺疊說明 expand 後可能會與 toast 通知重疊 | UI 重疊 | 摺疊內容使用 `overflow: hidden` + 動畫展開，與 `.toast-container`（position: fixed top）無位置衝突 |
| 實機（iOS Safari）CSS 與 Playwright 模擬可能有差異（參閱 `mobile-css-real-device-divergence.md`） | 版面在真機上異常 | 延續現有的 `.mobile` JS fallback class 機制，Secrets 頁面不需要新增額外 fallback |

## Open Questions

（無 — 設計決策已充分討論）
