# Mobile CSS 在真機失效 — Desktop Playwright 過測但手機版面全壞的三個疊加原因

## Context

admin-mobile-support 實作後,Playwright (Chromium, 375px viewport) 全部測試通過,但使用者的實體手機(Chrome 與 Firefox 皆然)看到的仍是桌面版:sidebar 佔左半、☰ 出現在左下角。

## Problem

「桌面模擬過、真機壞」不是單一原因,而是三個獨立問題疊加,必須全部修掉才會好:

### 原因 1:Static files 無 cache header,手機永遠拿舊 CSS

Hono 的 static file serving 沒有送 `Cache-Control`/`ETag`。手機瀏覽器把改 mobile 之前的 `style.css` 永久快取。症狀:新 media query 根本沒進到手機。

### 原因 2:Media query 在部分真機不匹配

即使拿到新 CSS,`@media (max-width: 768px)` 在某些情況仍不匹配:瀏覽器 zoom out、Desktop site 模式(viewport 變 980px)、寬螢幕裝置。桌面 Playwright 設 375px 永遠匹配,無法暴露這個問題。

### 原因 3:`position: sticky` 在 flex row 內失效

`.app-layout { display: flex }`(預設 row 方向)。topbar 是 flex item,`position: sticky; top: 0` 不會把它釘到 viewport 頂部,而是被排在 flex row 的左緣——導致 ☰ 出現在畫面左下而非左上。桌面模擬時因為 sidebar 是 fixed,看不出 topbar 位置異常。

## Solution

**Cache-busting**:static asset URL 加版本參數,CSS/JS 每次改版 bump:

```html
<link rel="stylesheet" href="/static/style.css?v=20260728b" />
<script src="/static/app.js?v=20260728b" />
```

**JS mobile 偵測 fallback**(放在 `<head>` stylesheet 之前,同步執行):

```javascript
(function() {
  function checkMobile() {
    var isMobile = window.innerWidth <= 768 ||
      (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024);
    document.documentElement.classList.toggle("mobile", isMobile);
  }
  checkMobile();
  window.addEventListener("resize", checkMobile);
})();
```

CSS 加一組 `.mobile` 選擇器鏡像 media query 的關鍵規則(`.mobile .sidebar { transform: translateX(-100%) }` 等)。偵測條件刻意不收 `maxTouchPoints > 0` 單獨成立(觸控筆電 1280px+ 不該進 mobile 版面)。

**Column layout**:mobile 下 `.app-layout { flex-direction: column }`,topbar 自然排在頂部、全寬(`width: 100%; flex-shrink: 0`),不再依賴 sticky。

## Why It Works

- 版本參數讓 URL 改變 → 瀏覽器視為新資源,繞過快取
- JS 偵測用的是渲染後的 `window.innerWidth`(受 zoom/Desktop site 影響後的真實值),比 CSS media query 更能反映使用者實際 viewport
- `flex-direction: column` 從佈局結構上保證 topbar 在頂部,不依賴 sticky 在 flex 容器內的未定義行為

## Side Effects / Tradeoffs

- 版本參數要手動 bump(目前無 build-time injection);忘記 bump 會讓修正看起來「沒生效」
- `.mobile` class 與 media query 規則重複,兩邊要同步維護
- JS 偵測在 `<noscript>` 或 JS 被擋時失效——admin 本就全依賴 JS,可接受

## Evidence

- 真機截圖(修復前):sidebar 佔左半、☰ 在左下
- 修復後 Playwright:topbar top=0px、全寬 375px、flex-direction=column(11/11 pass)
- 1024px + touch 模擬:media query 不匹配但 `.mobile` class 生效,sidebar 正確隱藏(12/12 pass)
- Desktop 1280px no-touch:無 `.mobile` class,row 佈局不變

## Related Files

- `src/admin/views/layout.tsx` — 偵測腳本、版本參數
- `src/admin/static/style.css` — media query + `.mobile` 鏡像規則 + `flex-direction: column`
- `openspec/changes/admin-mobile-support/design.md` — D1-D6 原始決策

## Tags

- admin
- mobile
- css
- media-query
- cache-busting
- flexbox
- position-sticky
- real-device-testing
