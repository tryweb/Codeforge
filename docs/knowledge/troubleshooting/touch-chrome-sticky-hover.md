# Touch Chrome 的 Sticky Hover — `:hover` 樣式在點擊後殘留

## Context

ai-admin sidebar 的 nav link 有 hover 高亮:`background: rgba(16,185,129,0.1); color: var(--accent)`。使用者在手機 Chrome 點 About 連結後,綠色高亮一直殘留;Firefox 手機版則不會。兩邊看起來「差異很大」。

## Problem

Chrome(touch)在 tap 元素後會把 `:hover` 狀態「黏」在該元素上,直到使用者點別的地方。這是 Chromium 對觸控裝置模擬 hover 的設計,不是 bug,但會讓觸控 UI 出現誤導性的持久高亮。Firefox 手機版的處理不同(tap 後不保留 hover),因此跨瀏覽器外觀不一致。

受影響的不只 sidebar link,任何 `:hover` 規則都會:`.btn-outline:hover`、`.editable-field:hover .edit-btn` 等。

## Solution

把純裝飾性的 `:hover` 規則包進 `@media (hover: hover)`,只在有滑鼠/游標的裝置上生效;功能性的 `.active` class 規則保持不變:

```css
/* .active 永遠生效(目前頁面高亮) */
.sidebar nav a.active { background: rgba(16,185,129,0.1); color: var(--accent); }

/* :hover 只在能真正 hover 的裝置上生效 */
@media (hover: hover) {
  .sidebar nav a:hover { background: rgba(16,185,129,0.1); color: var(--accent); }
  .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
  .editable-field:hover .edit-btn { opacity: 1; }
}
```

`@media (hover: hover)` 是 CSS Media Queries Level 4 的 interaction media feature,在觸控裝置上為 false(即使裝置也接受滑鼠,primary input 是觸控就不匹配)。

## Why It Works

觸控裝置的 primary input 沒有 hover 能力,`hover: hover` 不匹配 → 規則不套用 → tap 後無殘留高亮。桌面滑鼠裝置 `hover: hover` 匹配 → hover 效果正常。`.active` 是 class 不是 pseudo-class,不受影響,目前頁面高亮保留。

## Side Effects / Tradeoffs

- 觸控裝置使用者完全看不到 hover 高亮(本來就看不到瞬間的,只會看到殘留的,所以是淨改善)
- 混合裝置(觸控筆電)以 primary input 判定;插上滑鼠仍是 touch-primary,hover 高亮不會出現——可接受的邊界情況

## Evidence

- 修復前使用者截圖:Chrome 上 About 連結持續綠色高亮,Firefox 正常
- Playwright 驗證(3/3 pass):
  - touch context:tap About 後 background 保持 `rgba(0, 0, 0, 0)`(無 sticky hover)
  - touch context:Dashboard 的 `.active` 高亮仍在
  - desktop context:hover About 時綠色高亮正常出現

## Related Files

- `src/admin/static/style.css` — 三處 `:hover` 規則包進 `@media (hover: hover)`

## Tags

- admin
- mobile
- css
- hover
- touch
- chrome
- cross-browser
