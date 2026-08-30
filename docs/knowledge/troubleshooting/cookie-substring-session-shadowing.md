# Admin 登入成功卻被彈回登入頁 — Cookie 名子字串誤匹配

## Context

- Staging admin（`http://<host>:8080`，ai-engkit-admin v1.16.4）登入：輸入正確密碼 `testadmin123`，伺服器**接受**（POST /api/login → 302 成功路徑，無 `error=1`），但下一跳 `GET /` 又被 authGuard 彈回 `/login`，使用者反覆無法登入。
- 同一 host（192.168.11.195）同時跑 OpenChamber web UI（port 8000，設定 `oc_ui_session` cookie）與 admin（8080）、dev admin（8081）。
- 所有 `.env` 快照的 `ADMIN_PASSWORD` 皆為 `testadmin123` —— 排除密碼錯誤。
- 全新瀏覽器（Playwright）同密碼可正常登入 → 差異只在瀏覽器 cookie 狀態。

## Problem

`src/admin/server.ts` authGuard（L94）用**未錨定 substring 比對**讀 session cookie：

```ts
const sessionMatch = cookie.match(/session=([^;]+)/);
```

`String.match` 回傳**第一個**出現 `session=` 子字串的位置。同 host 上其他應用的 cookie 名若含 `session=`（如 OpenChamber 的 `oc_ui_session`），且依 RFC 6265 §5.4（同 path 較早建立者排前）排序在真正 `session` 之前，authGuard 就會把 `oc_ui_session` 的值當成 session token → `validateSession` 失敗 → 彈回 `/login`。

Cookie 不分 port、只分 host + path：8000/8080/8081 的 cookie 在同一瀏覽器互通，故 OpenChamber 的 cookie 會污染 admin 的 session 讀取。

## Solution

將 regex 錨定到 cookie 邊界（行首或 `;` 之後），只匹配名稱確為 `session` 的 cookie：

```ts
const sessionMatch = cookie.match(/(?:^|;\s*)session=([^;]+)/);
```

並於 `src/admin/server.test.ts` 新增迴歸測試：`Cookie: oc_ui_session=stale.junk; session=<有效token>` 對 `/api/openchamber/settings` 應回 200。驗證過舊 regex 下該測試失敗（500），新 regex 下 4/4 全綠。

## Why It Works

- `(?:^|;\s*)` 要求 `session=` 前面只能是字串開頭或完整 cookie 分隔；`oc_ui_session=` 前是 `c_ui_` 等字元，不滿足 → 不再誤抓。
- 使用者立即解套：清除瀏覽器對該 host 的 cookies（或無痕視窗）即可登入，無需 deploy。

## Side Effects / Tradeoffs

- 修復在 repo 層（`src/admin/server.ts` + 測試）；staging container 內的舊 code 需重建 image 並重啟 admin container 才生效。
- `String.match` 只取第一個滿足條件的 cookie —— 若瀏覽器真的同時有兩個名稱相同的 `session` cookie（不同 path），仍以 header 順序為準；實務上同 host 同 path 同名的 cookie 會互相覆寫，此情況罕見。

## Evidence

- 伺服器日誌（使用者）：`POST /api/login → 302` → `GET / → 302` → `GET /login`（成功登入後被彈回）。
- curl 四態測試（直打 8080）：
  - `session=<有效>` → 200
  - `oc_ui_session=garbage; session=<有效>` → 302（bug 重現）
  - `session=<有效>; oc_ui_session=garbage` → 200（順序敏感）
  - `oc_ui_session=garbage` 單獨 → 302
- Playwright 重現：Run A（帶 `oc_ui_session` cookie）輸入正確密碼 → 停在 `/login`；Run B（乾淨）→ 進 `/` dashboard。
- `bun test server.test.ts`：修復後 4 pass / 0 fail；還原舊 regex 時新增測試 fail（500）。

## Related Files

- `src/admin/server.ts` — authGuard（修復點，L94）
- `src/admin/server.test.ts` — 迴歸測試（新增）
- `src/admin/lib/auth.ts` — `createSessionCookie`/`validateSession`（cookie 名 `session`、`Path=/`）
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — 同 host 多服務共存背景

## Tags

`cookie`, `session`, `authGuard`, `regex`, `hono`, `admin`, `login-loop`, `openchamber`